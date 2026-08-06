import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '@/app.module';
import { DRIZZLE, DrizzleDB } from '@/shared/database/database.module';
import { providersTable } from '@/modules/providers/provider.schema';
import { webhooksTable } from '@/modules/webhooks/webhook.schema';
import { transactionsTable } from '@/modules/transactions/transaction.schema';
import { UnprocessedEvent } from '@/modules/webhooks/webhook.types';
import { deadLetterEventsTable } from '@/modules/webhooks/dead-letter.schema';

describe('Reconciliation status (e2e)', () => {
  let app: INestApplication;
  let db: DrizzleDB;
  let providerId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = moduleRef.get<DrizzleDB>(DRIZZLE);
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

  let seq = 0;
  const seedWebhook = async (
    overrides: {
      receivedAt?: Date;
      status?: 'received' | 'processed' | 'pending_manual_review';
      processedAt?: Date | null;
      externalEventId?: string;
    } = {},
  ) => {
    seq += 1;
    const [row] = await db
      .insert(webhooksTable)
      .values({
        providerId,
        externalEventId: overrides.externalEventId ?? `evt_recon_${seq}`,
        status: overrides.status ?? 'received',
        processedAt: overrides.processedAt ?? null,
        // si no pasás receivedAt, Postgres usa defaultNow() (no determinista para orden)
        ...(overrides.receivedAt ? { receivedAt: overrides.receivedAt } : {}),
        payload: {
          id: `evt_recon_${seq}`,
          object: 'event',
          type: 'payment_intent.succeeded',
          data: { object: { id: 'pi_1', amount: 2000, currency: 'usd' } },
        },
      })
      .returning();
    return row;
  };

  // Fechas testigo para aging determinista (más viejo → más nuevo).
  const oldest = new Date('2026-06-01T00:00:00.000Z');
  const middle = new Date('2026-06-05T00:00:00.000Z');
  const newest = new Date('2026-06-09T00:00:00.000Z');

  describe('orden por aging (received_at asc)', () => {
    it('lista los unprocessed del más viejo al más nuevo', async () => {
      const middleEvt = await seedWebhook({
        receivedAt: middle,
        externalEventId: 'evt_middle',
      });
      const newestEvt = await seedWebhook({
        receivedAt: newest,
        externalEventId: 'evt_newest',
      });
      const oldestEvt = await seedWebhook({
        receivedAt: oldest,
        externalEventId: 'evt_oldest',
      });

      const res = await request(app.getHttpServer()).get(
        '/webhooks/reconciliation-status',
      );

      expect(res.statusCode).toBe(200);
      expect(res.body.unprocessedEvents.length).toBe(3);
      expect(
        (res.body.unprocessedEvents as UnprocessedEvent[]).findIndex(
          (evt) => evt.id === oldestEvt.id,
        ),
      ).toBe(0);
      expect(
        (res.body.unprocessedEvents as UnprocessedEvent[]).findIndex(
          (evt) => evt.id === middleEvt.id,
        ),
      ).toBe(1);
      expect(
        (res.body.unprocessedEvents as UnprocessedEvent[]).findIndex(
          (evt) => evt.id === newestEvt.id,
        ),
      ).toBe(2);
    });
  });

  describe('predicado: solo processed_at IS NULL', () => {
    it('excluye los procesados (caso NEGATIVO que prueba el WHERE)', async () => {
      const evt1 = await seedWebhook({
        receivedAt: oldest,
        externalEventId: 'evt_pending_1',
      });
      const evt2 = await seedWebhook({
        receivedAt: newest,
        externalEventId: 'evt_pending_2',
      });
      await seedWebhook({
        receivedAt: new Date('2026-05-01T00:00:00.000Z'),
        status: 'processed',
        processedAt: middle,
        externalEventId: 'evt_processed',
      });

      const res = await request(app.getHttpServer()).get(
        '/webhooks/reconciliation-status',
      );

      expect(res.statusCode).toBe(200);
      expect(res.body.unprocessedEvents.length).toBe(2);
      expect(
        (res.body.unprocessedEvents as UnprocessedEvent[]).findIndex(
          (evt) => evt.id === evt1.id,
        ),
      ).toBe(0);
      expect(
        (res.body.unprocessedEvents as UnprocessedEvent[]).findIndex(
          (evt) => evt.id === evt2.id,
        ),
      ).toBe(1);
    });
  });

  describe('caso borde: nada pendiente', () => {
    it('todo procesado → lista vacía, no error', async () => {
      await seedWebhook({
        status: 'processed',
        processedAt: newest,
        externalEventId: 'evt_done',
      });

      const res = await request(app.getHttpServer()).get(
        '/webhooks/reconciliation-status',
      );

      expect(res.statusCode).toBe(200);
      expect(res.body.unprocessedEvents.length).toBe(0);
    });
  });

  // CARRYOVER (Día 20 → lunes): la Unidad 2 (counts) cambió la query a
  // `count(*) filter (...)` SIN group by, que materializa processed=0 cuando no hay
  // processed (el GROUP BY viejo lo OMITÍA → bug). Ese comportamiento vive en el SQL:
  // el mock del repo no puede probarlo, solo un e2e con DB real. Hoy queda sin cubrir
  // (verde por ausencia, no por cobertura). Levantar junto con Pino.
  describe('counts derivados (partición + subset) — CARRYOVER', () => {
    it('materializa processed=0 cuando NO hay eventos processed (prueba el FILTER)', async () => {
      // Sin filas `processed`. El `GROUP BY` viejo omitía la clave entera y el
      // campo llegaba `undefined`; `count(*) filter (...)` la materializa en 0.
      await seedWebhook({
        status: 'pending_manual_review',
        externalEventId: 'evt_only_pending',
      });

      const res = await request(app.getHttpServer()).get(
        '/webhooks/reconciliation-status',
      );

      expect(res.statusCode).toBe(200);
      expect(res.body.eventsByStatus.processed).toBe(0);
      expect(res.body.eventsByStatus.pendingManualReview).toBe(1);
      expect(res.body.total).toBe(1);
    });

    it('deadLettered cuenta eventos únicos (countDistinct) y NO infla el total (subset de pending_manual_review)', async () => {
      // Un solo evento muerto con DOS filas de anexo: el anexo es append-only y
      // acumula una fila por muerte (ADR-011), así que contar filas mentiría.
      const dead = await seedWebhook({
        status: 'pending_manual_review',
        externalEventId: 'evt_dead_twice',
      });
      await db.insert(deadLetterEventsTable).values([
        {
          eventId: dead.id,
          generation: 0,
          reason: 'first_death',
          lastError: null,
        },
        {
          eventId: dead.id,
          generation: 1,
          reason: 'second_death',
          lastError: null,
        },
      ]);
      await seedWebhook({
        status: 'processed',
        processedAt: newest,
        externalEventId: 'evt_ok',
      });

      const res = await request(app.getHttpServer()).get(
        '/webhooks/reconciliation-status',
      );

      expect(res.statusCode).toBe(200);
      // dos filas de anexo, un evento
      expect(res.body.deadLetteredEvents).toBe(1);
      // dead-lettered es un SUBSET de pending_manual_review, no una tercera
      // partición: el total son los estados terminales, y sumarlo lo inflaría.
      expect(res.body.eventsByStatus.pendingManualReview).toBe(1);
      expect(res.body.eventsByStatus.processed).toBe(1);
      expect(res.body.total).toBe(2);
    });
  });
});
