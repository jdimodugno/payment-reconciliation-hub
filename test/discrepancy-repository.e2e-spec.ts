import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { AppModule } from '@/app.module';
import { DRIZZLE, DrizzleDB } from '@/shared/database/database.module';
import { discrepanciesTable } from '@/modules/reconciliation/reconciliation.schema';
import { DiscrepancyRepository } from '@/modules/reconciliation/reconciliation.repository';
import {
  fromRow,
  DiscrepancyRow,
} from '@/modules/reconciliation/mapper/discrepancy.mapper';
import { MissingInternal } from '@/modules/reconciliation/reconciliation.types';
import { Money } from '@/shared/money/money';
import { Currencies } from '@/shared/money/currency';

describe('DiscrepancyRepository (e2e, DB real)', () => {
  let app: INestApplication;
  let db: DrizzleDB;
  let repo: DiscrepancyRepository;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = moduleRef.get<DrizzleDB>(DRIZZLE);
    repo = moduleRef.get<DiscrepancyRepository>(DiscrepancyRepository);
  });

  beforeEach(async () => {
    await db.delete(discrepanciesTable);
  });

  afterAll(async () => {
    await app.close();
  });

  // Un missing_internal: lado provider presente, lado interno AUSENTE (internalId NULL).
  // Elegido porque ejerce lo que el resto no: (a) Money cruzando el jsonb real,
  // (b) el NULL del par que activa nullsNotDistinct.
  const aMissingInternal = (providerRef: string): MissingInternal => ({
    kind: 'missing_internal',
    providerRef,
    providerAmount: Money.fromDecimal('105.50', Currencies.USD),
    providerStatus: 'succeeded',
  });

  const selectRow = async (): Promise<DiscrepancyRow> => {
    const [row] = await db.select().from(discrepanciesTable);
    return row;
  };

  const countRows = async (): Promise<number> => {
    const [{ c }] = await db
      .select({ c: sql<number>`count(*)`.mapWith(Number) })
      .from(discrepanciesTable);
    return c;
  };

  describe('round-trip contra jsonb real', () => {
    // Lo que el test simulado del d25 (JSON.parse(JSON.stringify)) NO podía probar:
    // nunca salía de Node. Acá el dato cruza driver -> Postgres jsonb -> driver.
    it('save persiste y fromRow re-hidrata el Money a través del jsonb de Postgres', async () => {
      const original = aMissingInternal('prov-rt-1');

      await repo.save(original);
      const back = fromRow(await selectRow()) as MissingInternal & {
        id: string;
      };

      expect(back.kind).toBe('missing_internal');
      // T1: el monto sobrevive la frontera real sin perder precisión ni currency.
      expect(back.providerAmount.toDecimal()).toBe(
        original.providerAmount.toDecimal(),
      );
      expect(back.providerAmount.getCurrency()).toBe(
        original.providerAmount.getCurrency(),
      );
      expect(back.providerStatus).toBe(original.providerStatus);
      expect(back.providerRef).toBe(original.providerRef);
    });
  });

  describe('idempotencia (nullsNotDistinct end-to-end)', () => {
    // La aserción que dice la verdad (como el count===1 del webhook d7):
    // el lado interno es NULL; un UNIQUE estándar dejaría entrar el duplicado.
    // nullsNotDistinct + onConflictDoNothing lo frenan. count===1 lo prueba.
    it('save dos veces del mismo par + kind con lado NULL no duplica (count===1)', async () => {
      const d = aMissingInternal('prov-dup-1');

      await repo.save(d);
      await repo.save(d);

      expect(await countRows()).toBe(1);
    });
  });
});
