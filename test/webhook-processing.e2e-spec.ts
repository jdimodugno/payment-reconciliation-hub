import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '@/app.module';
import { DRIZZLE, DrizzleDB } from '@/shared/database/database.module';
import { providersTable } from '@/modules/providers/provider.schema';
import { webhooksTable } from '@/modules/webhooks/webhook.schema';
import { transactionsTable } from '@/modules/transactions/transaction.schema';
import { WebhookService } from '@/modules/webhooks/webhooks.service';
import { eq } from 'drizzle-orm';
import { WebhookEvent } from '@/modules/webhooks/webhook.types';

// Procesamiento NO es HTTP. Dos formas de dispararlo contra DB real:
//  - directo: service.processSingleEvent(row) → síncrono, aísla la unidad de procesamiento.
//  - async real: service.createWebhookNotification(...) → persiste 'received' + encola;
//    el worker registrado (BullMQ) consume y procesa en background (hay que ESPERARLO).
describe('Webhook processing (e2e)', () => {
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

  // Inserta un webhook 'received' listo para procesar. Ajustá el payload/estado por test.
  const seedReceivedWebhook = async (
    overrides: Record<string, unknown> = {},
  ) => {
    const [row] = await db
      .insert(webhooksTable)
      .values({
        providerId,
        externalEventId: 'evt_proc_1',
        status: 'received',
        payload: {
          id: 'evt_proc_1',
          object: 'event',
          type: 'payment_intent.succeeded',
          data: { object: { id: 'pi_1', amount: 2000, currency: 'usd' } },
        },
        ...overrides,
      })
      .returning();
    return row;
  };

  const countTransactions = async () =>
    (await db.select().from(transactionsTable)).length;

  const fetchWebhook = async (id: string) =>
    (await db.select().from(webhooksTable).where(eq(webhooksTable.id, id)))[0];

  // Espera activa: re-evalúa `check` hasta que sea truthy o se agote el timeout.
  // Necesario porque el worker procesa ASYNC: tras encolar, el efecto no es inmediato.
  // Trade-off conocido (deuda Día 11): un timeout muy ajustado puede ponerse flaky.
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

  describe('idempotencia de procesamiento (el test del día)', () => {
    // LA aserción que cuenta la verdad: procesar 2 veces, UNA sola Transaction.
    it('procesar el mismo evento 2 veces → count(transactions) === 1', async () => {
      const pre = await countTransactions();
      expect(pre).toBe(0);
      const rawRow = await seedReceivedWebhook();
      const row: WebhookEvent = {
        ...rawRow,
        receivedAt: rawRow.receivedAt.toISOString(),
        processedAt: null,
      };
      await service.processSingleEvent(row);
      const post1 = await countTransactions();
      expect(post1).toBe(1);
      await service.processSingleEvent(row);
      const post2 = await countTransactions();
      expect(post2).toBe(1);
    });
    it('el 2do procesamiento NO incrementa retries (already_processed ≠ fallo)', async () => {
      const pre = await countTransactions();
      expect(pre).toBe(0);
      const rawRow = await seedReceivedWebhook();
      const row: WebhookEvent = {
        ...rawRow,
        receivedAt: rawRow.receivedAt.toISOString(),
        processedAt: null,
      };
      await service.processSingleEvent(row);
      await service.processSingleEvent(row);
      const [post] = await db
        .select()
        .from(webhooksTable)
        .where(eq(webhooksTable.id, row.id));
      expect(post.retries).toBe(0);
    });
  });

  describe('caminos a manual review (no-retriables)', () => {
    /* caso skippeado porque no es generable
      it.skip(
        'event-type no mapeable → status pending_manual_review, reason UNSUPPORTED_EVENT_TYPE',
      );
    */
    it.todo(
      'currency no soportada → pending_manual_review, reason UNSUPPORTED_CURRENCY',
    );
  });

  describe('dead-letter por agotamiento (retriable)', () => {
    it('evento con retries >= MAX → pending_manual_review, reason RETRIES_EXHAUSTED, sin reprocesar', async () => {
      const rawRow = await seedReceivedWebhook({ retries: 3 });
      const row: WebhookEvent = {
        ...rawRow,
        receivedAt: rawRow.receivedAt.toISOString(),
        processedAt: null,
      };
      await service.processSingleEvent(row);
      const [post] = await db
        .select()
        .from(webhooksTable)
        .where(eq(webhooksTable.id, row.id));

      expect(post.status).toBe('pending_manual_review');
      expect(post.reason).toBe('retries_exhausted');
    });
  });

  describe('flujo async end-to-end (recepción → cola → worker → transacción)', () => {
    const rawStripeEvent = {
      id: 'evt_async_1',
      object: 'event',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_async_1', amount: 2000, currency: 'usd' } },
    };

    it('un webhook recibido se procesa async vía worker → count(transactions) === 1', async () => {
      expect(await countTransactions()).toBe(0);
      const { event } = await service.createWebhookNotification(
        providerId,
        rawStripeEvent,
      );

      await waitFor(
        async () => (await fetchWebhook(event.id)).status !== 'received',
      );

      const processed = await fetchWebhook(event.id);
      expect(await countTransactions()).toBe(1);
      expect(processed.status).toBe('processed');
      expect(processed.processedAt).not.toBeNull();
    });

    // El claim atómico (Día 8) sigue siendo el árbitro bajo at-least-once.
    // Diferido (costo/beneficio): el claim como árbitro ya está cubierto determinísticamente
    // en 'procesar el mismo evento 2 veces → count === 1' (vía processSingleEvent directo).
    // Un e2e de reentrega real exigiría derrotar el jobId dedup + timing concurrente = flaky.
    // Reabrir si: se observa doble-Transaction en prod, o se endurece el aislamiento de cola en e2e.
    it.todo(
      'reentrega del mismo evento (encolar 2x) → sigue count === 1 (claim como árbitro)',
    );
  });
});
