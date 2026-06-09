import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest'; // ya está en devDeps
import { AppModule } from '@/app.module';
import { DRIZZLE, DrizzleDB } from '@/shared/database/database.module';
import { providersTable } from '@/modules/providers/provider.schema';
import { webhooksTable } from '@/modules/webhooks/webhook.schema';
import { eq } from 'drizzle-orm';
import { transactionsTable } from '@/modules/transactions/transaction.schema';

describe('Webhooks (e2e)', () => {
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

  const stripeEvent = (id = 'evt_123') => ({
    id,
    object: 'event',
    type: 'payment_intent.succeeded',
    data: { object: { id: 'pi_1', amount: 2000, currency: 'usd' } },
  });

  it('crea el evento nuevo → 201', async () => {
    await request(app.getHttpServer())
      .post(`/webhooks/${providerId}`)
      .send(stripeEvent())
      .expect(201);
  });

  // EL test del día: idempotencia real contra el UNIQUE constraint.
  it('mismo webhook 2 veces → se persiste 1 sola vez (200 en el 2do)', async () => {
    const evt = stripeEvent();

    await request(app.getHttpServer())
      .post(`/webhooks/${providerId}`)
      .send(evt)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/webhooks/${providerId}`)
      .send(evt)
      .expect(200);

    // LA aserción que cuenta la verdad: no "no explotó", sino UN solo row.
    const rows = await db
      .select()
      .from(webhooksTable)
      .where(eq(webhooksTable.providerId, providerId));
    expect(rows).toHaveLength(1);
  });

  it('provider inexistente → 404', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    await request(app.getHttpServer())
      .post(`/webhooks/${fakeId}`)
      .send(stripeEvent())
      .expect(404);
  });

  it('payload basura → 400', async () => {
    await request(app.getHttpServer())
      .post(`/webhooks/${providerId}`)
      .send({ garbage: true })
      .expect(400);
  });
});
