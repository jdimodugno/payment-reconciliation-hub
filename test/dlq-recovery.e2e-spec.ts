import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '@/app.module';
import { DRIZZLE, DrizzleDB } from '@/shared/database/database.module';
import { providersTable } from '@/modules/providers/provider.schema';
import { webhooksTable } from '@/modules/webhooks/webhook.schema';
import { transactionsTable } from '@/modules/transactions/transaction.schema';
import { deadLetterEventsTable } from '@/modules/webhooks/dead-letter.schema';
import { WebhookService } from '@/modules/webhooks/webhooks.service';
import { EventNotReprocessableError } from '@/modules/webhooks/webhook.exception';
import { eq } from 'drizzle-orm';

// ADR-015: recovery / reinjection de un evento dead-lettered vía flip transitorio.
describe('DLQ recovery / reinjection (e2e)', () => {
  let app: INestApplication;
  let db: DrizzleDB;
  let service: WebhookService;
  let providerId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = moduleRef.get<DrizzleDB>(DRIZZLE);
    service = moduleRef.get<WebhookService>(WebhookService);
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
  });

  afterAll(async () => {
    await app.close();
  });

  // Siembra un muerto: status pending_manual_review + N filas en el anexo.
  const seedDeadEvent = async (
    payload: Record<string, unknown>,
    deaths = 1,
  ) => {
    const [event] = await db
      .insert(webhooksTable)
      .values({
        providerId,
        externalEventId: 'evt_dlq_recovery_1',
        status: 'pending_manual_review',
        payload,
      })
      .returning();
    for (let i = 0; i < deaths; i++) {
      await db.insert(deadLetterEventsTable).values({
        eventId: event.id,
        generation: i,
        reason: 'unsupported_event_type',
        lastError: null,
      });
    }
    return event;
  };

  const fetchWebhook = async (id: string) =>
    (await db.select().from(webhooksTable).where(eq(webhooksTable.id, id)))[0];

  const countTransactions = async () =>
    (await db.select().from(transactionsTable)).length;

  const waitFor = async (
    check: () => Promise<boolean>,
    { timeoutMs = 5000, intervalMs = 50 } = {},
  ): Promise<void> => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await check()) return;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error(`waitFor: condición no cumplida en ${timeoutMs}ms`);
  };

  const validStripePayload = {
    id: 'evt_dlq_recovery_1',
    object: 'event',
    type: 'payment_intent.succeeded',
    data: { object: { id: 'pi_dlq_1', amount: 2000, currency: 'usd' } },
  };

  describe('happy recovery (el test que prueba que el jobId NO se dedupea)', () => {
    it('un muerto reinyectado se procesa async vía worker → processed + transacción', async () => {
      // Si el jobId determinístico se hubiera reusado, BullMQ lo deduplicaría y el
      // evento quedaría en pending_manual_review para siempre (waitFor → timeout).
      // Que llegue a 'processed' PRUEBA que el flip + jobId por-intento re-encolaron.
      const dead = await seedDeadEvent(validStripePayload, 1);
      expect(await countTransactions()).toBe(0);

      await service.reprocess(dead.id);

      await waitFor(
        async () => (await fetchWebhook(dead.id)).status === 'processed',
      );

      const recovered = await fetchWebhook(dead.id);
      expect(recovered.status).toBe('processed');
      expect(recovered.processedAt).not.toBeNull();
      expect(await countTransactions()).toBe(1);
    });
  });

  describe('guarda de reprocesabilidad (ADR-015, gotcha 1)', () => {
    it('reprocess sobre un evento ya processed → EventNotReprocessableError, sin cambios', async () => {
      const [processed] = await db
        .insert(webhooksTable)
        .values({
          providerId,
          externalEventId: 'evt_already_processed',
          status: 'processed',
          processedAt: new Date(),
          payload: validStripePayload,
        })
        .returning();

      await expect(service.reprocess(processed.id)).rejects.toThrow(
        EventNotReprocessableError,
      );

      // el árbitro atómico no tocó el estado
      const after = await fetchWebhook(processed.id);
      expect(after.status).toBe('processed');
      expect(await countTransactions()).toBe(0);
    });
  });
});
