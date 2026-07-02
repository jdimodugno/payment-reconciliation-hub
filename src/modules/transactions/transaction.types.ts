import { LogSerializer } from '@/shared/logging/log-serializer.interface';
import { Currencies } from '@/shared/money/currency';
import { Money } from '@/shared/money/money';

export type TransactionType = 'payin' | 'payout';
export type TransactionStatus = 'pending' | 'settled' | 'failed' | 'reversed';

export type Transaction = {
  id: string;
  externalId: string;
  providerId: string;
  amount: Money;
  currency: Currencies;
  status: TransactionStatus;
  type: TransactionType;
  createdAt: string;
  metadata: Record<string, unknown> | null;
};

export const TransactionSerializer: LogSerializer<Transaction> = {
  name: 'Transaction',
  allowlist: ['id', 'providerId', 'type', 'status'],
};
