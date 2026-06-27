import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '@/app.module';
import { DRIZZLE, DrizzleDB } from '@/shared/database/database.module';
import { providersTable } from '@/modules/providers/provider.schema';
import { webhooksTable } from '@/modules/webhooks/webhook.schema';
import { transactionsTable } from '@/modules/transactions/transaction.schema';
import { deadLetterEventsTable } from '@/modules/webhooks/dead-letter.schema';
import { DeadLetterRepository } from '@/modules/webhooks/dead-letter.repository';
import { eq } from 'drizzle-orm';

describe('Dead-letter annex (e2e)', () => {
  let app: INestApplication;
  let db: DrizzleDB;
  let repo: DeadLetterRepository;
  let providerId: string;
  let eventId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = moduleRef.get<DrizzleDB>(DRIZZLE);
    repo = moduleRef.get<DeadLetterRepository>(DeadLetterRepository);
  });

  beforeEach(async () => {
    await db.delete(deadLetterEventsTable);
    await db.delete(webhooksTable);
    await db.delete(transactionsTable);
    await db.delete(providersTable);
    const [p] = await db
      .insert(providersTable)
      .values({ name: 'stripe', type: 'payment', enabled: true })
      .returning();
    providerId = p.id;
    const [e] = await db
      .insert(webhooksTable)
      .values({
        providerId,
        externalEventId: 'evt_dl_1',
        status: 'pending_manual_review',
        payload: {},
      })
      .returning();
    eventId = e.id;
  });

  afterAll(async () => {
    await app.close();
  });

  const fetchDeadLetterEventsForId = async () =>
    await db
      .select()
      .from(deadLetterEventsTable)
      .where(eq(deadLetterEventsTable.eventId, eventId));

  const countDeadLetterEventsForId = async () =>
    (await fetchDeadLetterEventsForId()).length;

  it('appends a single dead-letter row pointing at the event', async () => {
    await repo.append({
      eventId,
      reason: 'forced_append',
      lastError: null,
    });
    const rows = await fetchDeadLetterEventsForId();
    expect(rows.length).toBe(1);
    expect(rows[0].failedAt).not.toBeUndefined();
  });
  it('appends N rows for the same event (audit trail, never updates)', async () => {
    expect(await countDeadLetterEventsForId()).toBe(0);
    await repo.append({
      eventId,
      reason: 'first_append',
      lastError: null,
    });
    expect(await countDeadLetterEventsForId()).toBe(1);
    await repo.append({
      eventId,
      reason: 'second_append',
      lastError: null,
    });
    const rows = await fetchDeadLetterEventsForId();
    expect(rows.length).toBe(2);
    expect(rows.every((dlqevent) => dlqevent.eventId === eventId)).toBe(true);
  });
  it('does not store event state (status lives only in webhook_events)', async () => {
    await repo.append({
      eventId,
      reason: 'first_append',
      lastError: null,
    });
    const rows = await fetchDeadLetterEventsForId();
    expect(rows[0].failedAt).not.toBeUndefined();
    expect('status' in rows[0]).toBe(false);
  });

  // DEFERRED (Día 19, cabo #1 DLQ): el camino retriable-AGOTADO debe persistir al anexo
  // durable, pero hoy muere en el failed-set de BullMQ (volátil). Mecanismo pendiente:
  // hook @OnWorkerEvent('failed') con guarda attemptsMade >= attempts + sweep de
  // reconciliación (failed-en-BullMQ-sin-fila-en-anexo → repara). Diferido del MVP porque
  // el append idempotente choca con el diseño append-only multi-fila (audit trail) y
  // amerita diseño planificado. Ver README "Dead-letter" + ADR-011.
  it.todo(
    'appends a dead-letter row when a retriable job exhausts its attempts',
  );
});
