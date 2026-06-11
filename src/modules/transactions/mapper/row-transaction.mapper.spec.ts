import { Money } from '@/shared/money/money';
import { mapRowToTransaction } from './row-transaction.mapper';

function makeValidRow() {
  return {
    id: 'txn_1',
    externalId: 'ext_1',
    providerId: 'prov_1',
    amount: '100.00',
    currency: 'usd',
    createdAt: new Date('2026-06-10T00:00:00.000Z'),
    status: 'pending' as const,
    type: 'payin' as const,
    metadata: null,
  };
}

describe('mapRowToTransaction', () => {
  it('row con currency válida → mapea a Transaction de dominio', () => {
    const row = makeValidRow();
    const result = mapRowToTransaction(row);
    expect(result.amount).toBeInstanceOf(Money);
    expect(typeof result.createdAt).toBe('string');
    expect(result.status).toBe(row.status);
    expect(result.currency).toBe(row.currency);
    expect(result.type).toBe(row.type);
  });

  it('row con currency inválida → lanza Error (guard anti-corrupción)', () => {
    const row = makeValidRow();
    expect(() =>
      mapRowToTransaction({ ...row, currency: 'invalid' }),
    ).toThrow();
  });

  it('row con metadata null → metadata queda en null', () => {
    const row = makeValidRow();
    const result = mapRowToTransaction(row);
    expect(result.metadata).toBe(null);
  });
});
