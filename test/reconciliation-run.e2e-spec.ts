import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { AppModule } from '@/app.module';
import { DRIZZLE, DrizzleDB } from '@/shared/database/database.module';
import { providersTable } from '@/modules/providers/provider.schema';
import { webhooksTable } from '@/modules/webhooks/webhook.schema';
import { transactionsTable } from '@/modules/transactions/transaction.schema';
import { deadLetterEventsTable } from '@/modules/webhooks/dead-letter.schema';
import { discrepanciesTable } from '@/modules/reconciliation/reconciliation.schema';

/**
 * El shell de ADR-017, end-to-end contra DB real.
 *
 * Hasta el día 30 el motor era inalcanzable: `reconcile()` tenía cero callers
 * fuera de su propio spec, así que "el batch produce discrepancias reales" era
 * cierto sólo adentro de un proceso de test. Esto es lo que lo vuelve falsable.
 */
describe('Reconciliation run (e2e) — el shell de ADR-017', () => {
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
    await db.delete(discrepanciesTable);
    await db.delete(deadLetterEventsTable);
    await db.delete(transactionsTable);
    await db.delete(webhooksTable);
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

  // Lado provider: un webhook de Stripe. El shell lo re-enriquece al vuelo
  // (ADR-014: auditar, no confiar), así que el monto sale de acá en unidades
  // menores — 2000 = 20.00 USD.
  const seedProviderEvent = async (
    externalId: string,
    amountMinor: number,
    type = 'payment_intent.succeeded',
  ) => {
    await db.insert(webhooksTable).values({
      providerId,
      externalEventId: `evt_${externalId}`,
      status: 'processed',
      payload: {
        id: `evt_${externalId}`,
        object: 'event',
        type,
        data: {
          object: { id: externalId, amount: amountMinor, currency: 'usd' },
        },
      },
    });
  };

  // Lado interno: la Transaction que nuestro sistema cree que existe.
  const seedInternal = async (
    externalId: string,
    amount: string,
    status: 'settled' | 'failed' = 'settled',
  ) => {
    await db.insert(transactionsTable).values({
      providerId,
      externalId,
      amount,
      currency: 'usd',
      status,
      type: 'payin',
      metadata: {},
    });
  };

  const runReconciliation = async () =>
    request(app.getHttpServer()).post('/reconciliation/runs').expect(201);

  it('los dos lados coinciden → cero discrepancias, pero el run reporta qué escaneó', async () => {
    await seedProviderEvent('pi_ok', 2000);
    await seedInternal('pi_ok', '20.00');

    const { body } = await runReconciliation();

    expect(body.discrepancies).toBe(0);
    // `scanned` importa: un run limpio sobre CERO datos y uno sobre pares reales
    // se leen igual mirando sólo el conteo de hallazgos, y no significan lo mismo.
    expect(body.scanned).toEqual({ internal: 1, provider: 1, unreadable: 0 });
    expect(await db.select().from(discrepanciesTable)).toHaveLength(0);
  });

  it('detecta las tres formas de divergencia en una sola corrida', async () => {
    // amount_mismatch: mismo par, montos distintos.
    await seedProviderEvent('pi_amount', 2500);
    await seedInternal('pi_amount', '20.00');
    // state_mismatch: mismo par, estados distintos.
    await seedProviderEvent('pi_state', 2000, 'payment_intent.failed');
    await seedInternal('pi_state', '20.00', 'settled');
    // missing_internal: el provider lo reporta, nosotros no lo tenemos.
    await seedProviderEvent('pi_only_provider', 3000);
    // missing_provider: nosotros lo tenemos, el provider no lo reporta.
    await seedInternal('pi_only_internal', '40.00');

    const { body } = await runReconciliation();

    expect(body.discrepancies).toBe(4);
    expect(body.byKind).toEqual({
      amount_mismatch: 1,
      state_mismatch: 1,
      missing_internal: 1,
      missing_provider: 1,
    });

    const rows = await db.select().from(discrepanciesTable);
    expect(rows).toHaveLength(4);
    // Toda la corrida comparte runId: son observaciones del mismo momento.
    expect(new Set(rows.map((r) => r.runId)).size).toBe(1);
    expect(rows.every((r) => r.runId === body.runId)).toBe(true);
  });

  it('un par que diverge en DOS dimensiones deja DOS filas, no una', async () => {
    // ADR-013 decisión B: una discrepancia = una dimensión. Colapsarlas
    // escondería trabajo de remediación, porque cada una se arregla distinto.
    await seedProviderEvent('pi_both', 2500, 'payment_intent.failed');
    await seedInternal('pi_both', '20.00', 'settled');

    const { body } = await runReconciliation();

    expect(body.byKind).toEqual({ amount_mismatch: 1, state_mismatch: 1 });
  });

  // El corazón de ADR-017 D4. Con el árbitro viejo —(internalId, providerRef,
  // kind), sin runId— la segunda corrida chocaba el constraint y
  // `onConflictDoNothing` la descartaba EN SILENCIO: la tabla seguía mostrando
  // los $10 del lunes mientras producción divergía por $5000 el miércoles.
  it('dos corridas sobre la misma divergencia dejan DOS observaciones, no una', async () => {
    await seedProviderEvent('pi_persist', 2500);
    await seedInternal('pi_persist', '20.00');

    const first = await runReconciliation();
    const second = await runReconciliation();

    expect(first.body.runId).not.toBe(second.body.runId);

    const rows = await db.select().from(discrepanciesTable);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.runId))).toEqual(
      new Set([first.body.runId, second.body.runId]),
    );
  });

  it('la divergencia que CAMBIA entre corridas queda registrada, no pisada', async () => {
    // El escenario que motivó D4: lunes $5 de delta, miércoles $50.
    await seedProviderEvent('pi_growing', 2500);
    await seedInternal('pi_growing', '20.00');
    const first = await runReconciliation();

    await db
      .delete(webhooksTable)
      .where(eq(webhooksTable.externalEventId, 'evt_pi_growing'));
    await seedProviderEvent('pi_growing', 7000);
    const second = await runReconciliation();

    const rows = await db.select().from(discrepanciesTable);
    const deltaByRun = new Map(rows.map((r) => [r.runId, r.delta]));

    // Las dos verdades conviven, cada una atada a la corrida que la observó.
    expect(deltaByRun.get(first.body.runId)).toBe('5.000000000000000000');
    expect(deltaByRun.get(second.body.runId)).toBe('50.000000000000000000');
  });

  // Un evento malformado no es hipotético: es lo que vive en manual review. La
  // primera versión del shell llamaba `fetchDetails` sin red, así que UN evento
  // roto de hace tres meses hacía fallar la corrida entera — y ningún test lo
  // veía, porque todos sembraban datos sanos.
  it('un evento ilegible no voltea la corrida y se cuenta como unreadable', async () => {
    await seedProviderEvent('pi_ok', 2000);
    await seedInternal('pi_ok', '20.00');
    await db.insert(webhooksTable).values({
      providerId,
      externalEventId: 'evt_broken',
      status: 'pending_manual_review',
      payload: {
        id: 'evt_broken',
        object: 'event',
        type: 'payment_intent.disputed',
        data: { object: { id: 'pi_broken' } },
      },
    });

    const { body } = await runReconciliation();

    expect(body.scanned).toEqual({ internal: 1, provider: 1, unreadable: 1 });
    // Y sobre todo: NO aparece como missing_provider. El provider sí lo reportó;
    // lo que no pudimos fue leerlo, y eso no es una divergencia.
    expect(body.discrepancies).toBe(0);
  });

  it('un evento ilegible NO se disfraza de par sano: el conteo lo delata', async () => {
    // Una corrida sin hallazgos sobre datos ilegibles se lee igual que una sana
    // si mirás sólo `discrepancies`. `unreadable` es lo que rompe esa ambigüedad
    // — misma razón por la que un fallo de lectura no se colapsa en `null`.
    await db.insert(webhooksTable).values({
      providerId,
      externalEventId: 'evt_broken_only',
      status: 'pending_manual_review',
      payload: {
        id: 'evt_broken_only',
        object: 'event',
        type: 'nope',
        data: { object: { id: 'pi_x' } },
      },
    });

    const { body } = await runReconciliation();

    expect(body.discrepancies).toBe(0);
    expect(body.scanned.unreadable).toBe(1);
  });
});
