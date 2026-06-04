import { Currencies } from '@/shared/money/currency';
import { Money } from '@/shared/money/money';

export type Transaction = {
  id: string;
  externalId: string;
  providerId: string;
  amount: Money;
  currency: Currencies;
  status: 'pending' | 'settled' | 'failed' | 'reversed';
  type: 'payin' | 'payout';
  createdAt: string;
  metadata: Record<string, unknown> | null;
};
