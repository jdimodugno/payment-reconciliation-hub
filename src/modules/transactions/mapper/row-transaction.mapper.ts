import { isValidCurrency } from '@/shared/money/currency';
import { Transaction } from '../transaction.types';
import { transactionsTable } from '../transaction.schema';
import { Money } from '@/shared/money/money';

export function mapRowToTransaction(
  row: typeof transactionsTable.$inferSelect,
): Transaction {
  if (!isValidCurrency(row.currency)) {
    throw new Error(`Invalid currency from DB: ${row.currency}`);
  }

  return {
    id: row.id,
    externalId: row.externalId,
    providerId: row.providerId,
    amount: Money.fromDecimal(row.amount, row.currency),
    currency: row.currency,
    createdAt: row.createdAt.toISOString(),
    status: row.status,
    type: row.type,
    metadata: row.metadata ?? null,
  };
}
