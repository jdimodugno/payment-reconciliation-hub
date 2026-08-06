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
      generation: 0,
      reason: 'forced_append',
      lastError: null,
    });
    const rows = await fetchDeadLetterEventsForId();
    expect(rows.length).toBe(1);
    expect(rows[0].failedAt).not.toBeUndefined();
  });
  // This used to assert "N appends -> N rows", which was ADR-011's original
  // append-only behaviour. It no longer describes production: after ADR-016 made
  // `append` propagate, BullMQ retries the whole transition, and those retries are
  // THE SAME death. The two cases below are what production can actually produce,
  // and they are the two halves of the arbiter — without
  // UNIQUE (event_id, generation) the first one fails with 2 rows instead of 1.
  it('converges to one row when the same death is recorded twice (retry of a failed transition)', async () => {
    expect(await countDeadLetterEventsForId()).toBe(0);

    // Same generation twice = the same death being re-recorded. Nothing bumped
    // `webhook_events.retries` in between, because a reactivation is the only
    // thing that can, and it requires the event to already be in manual review.
    await repo.append({
      eventId,
      generation: 0,
      reason: 'first_append',
      lastError: null,
    });
    await repo.append({
      eventId,
      generation: 0,
      reason: 'first_append',
      lastError: null,
    });

    const rows = await fetchDeadLetterEventsForId();
    expect(rows.length).toBe(1);
    expect(rows[0].reason).toBe('first_append');
  });

  it('appends a new row for a death in a later generation (real re-death)', async () => {
    await repo.append({
      eventId,
      generation: 0,
      reason: 'first_death',
      lastError: null,
    });
    // A reactivation flip happened in between, so `retries` moved to 1.
    await repo.append({
      eventId,
      generation: 1,
      reason: 'second_death',
      lastError: null,
    });

    const rows = await fetchDeadLetterEventsForId();
    expect(rows.length).toBe(2);
    expect(rows.map((r) => r.generation).sort()).toEqual([0, 1]);
    expect(rows.every((dlqevent) => dlqevent.eventId === eventId)).toBe(true);
  });
  it('does not store event state (status lives only in webhook_events)', async () => {
    await repo.append({
      eventId,
      generation: 0,
      reason: 'first_append',
      lastError: null,
    });
    const rows = await fetchDeadLetterEventsForId();
    expect(rows[0].failedAt).not.toBeUndefined();
    expect('status' in rows[0]).toBe(false);
  });

  // T5: `append` used to swallow write failures, returning a clean `void`.
  // The caller then flipped the event to `pending_manual_review`, producing an
  // event in manual review with no annex row — an unauditable failure.
  // Forced against the real DB via the event_id FK (ADR-011): an eventId with
  // no matching webhook_events row is a genuine constraint violation, not a mock.
  it('propagates the write failure instead of swallowing it (T5)', async () => {
    const orphanEventId = '00000000-0000-0000-0000-000000000000';

    await expect(
      repo.append({
        eventId: orphanEventId,
        generation: 0,
        reason: 'forced_failure',
        lastError: null,
      }),
    ).rejects.toThrow();

    const orphanRows = await db
      .select()
      .from(deadLetterEventsTable)
      .where(eq(deadLetterEventsTable.eventId, orphanEventId));
    expect(orphanRows.length).toBe(0);
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
