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
import { UnsupportedCurrencyError } from '@/modules/webhooks/webhook.exception';
import { NonRetriableError } from '@/shared/exception/non-retriable.exception';
import { deadLetterEventsTable } from '@/modules/webhooks/dead-letter.schema';

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
    // This test replaced an `it.todo` that assumed an unsupported currency
    // reached `pending_manual_review`. It does not, and cannot: the guard that
    // produced that reason sat after `fetchDetails`, which rejects the currency
    // first. Only a mocked provider could reach it. The real behaviour is a
    // non-retriable failure raised at the anti-corruption boundary, so the
    // consumer stops retrying a value that can never become valid.
    it('currency no soportada → UnsupportedCurrencyError (no-retriable) en el borde, sin transacción', async () => {
      const rawRow = await seedReceivedWebhook({
        externalEventId: 'evt_bad_currency',
        payload: {
          id: 'evt_bad_currency',
          object: 'event',
          type: 'payment_intent.succeeded',
          data: { object: { id: 'pi_bad', amount: 2000, currency: 'xyz' } },
        },
      });
      const row: WebhookEvent = {
        ...rawRow,
        receivedAt: rawRow.receivedAt.toISOString(),
        processedAt: null,
      };

      await expect(service.processSingleEvent(row)).rejects.toBeInstanceOf(
        UnsupportedCurrencyError,
      );
      // non-retriable: the consumer maps it to UnrecoverableError, so BullMQ
      // does not burn three attempts on it.
      await expect(service.processSingleEvent(row)).rejects.toBeInstanceOf(
        NonRetriableError,
      );

      const stored = await fetchWebhook(row.id);
      expect(stored.status).toBe('received');
      expect(stored.processedAt).toBeNull();
      expect(await countTransactions()).toBe(0);

      // KNOWN GAP (dead-letter.e2e it.todo, deferred since d19): the event dies
      // in BullMQ's volatile failed-set with no annex row, so it leaves no
      // durable audit trail. Same hole `MalformedProviderEventError` already
      // has; it needs the retry-exhausted mechanism, not a test.
      const annex = await db
        .select()
        .from(deadLetterEventsTable)
        .where(eq(deadLetterEventsTable.eventId, row.id));
      expect(annex.length).toBe(0);
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

    it('reentrega del mismo evento (encolar 2x) → sigue count === 1 (claim como árbitro)', async () => {
      const seededEvent = await seedReceivedWebhook();

      await Promise.all([
        service.processSingleEventById(seededEvent.id),
        service.processSingleEventById(seededEvent.id),
      ]);

      const [row] = await db
        .select()
        .from(webhooksTable)
        .where(eq(webhooksTable.id, seededEvent.id));

      expect(row).not.toBeFalsy();
      expect(row.status).toBe('processed');
      expect(row.processedAt).not.toBeNull();
      expect(await countTransactions()).toBe(1);
    });
  });
});
