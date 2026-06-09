import {
  TransactionStatus,
  TransactionType,
} from '@/modules/transactions/transaction.types';
import { ProviderEventType } from '../../providers/provider-event.type';

type TransactionMapping = {
  status: TransactionStatus;
  type: TransactionType;
};

const EVENT_TO_TRANSACTION: Record<ProviderEventType, TransactionMapping> = {
  'payment.succeeded': { status: 'settled', type: 'payin' },
  'payment.failed': { status: 'failed', type: 'payin' },
  'payment.refunded': { status: 'reversed', type: 'payin' },
};

function isProviderEventType(
  candidate: string,
): candidate is ProviderEventType {
  return Object.hasOwn(EVENT_TO_TRANSACTION, candidate);
}

export function mapEventToTransaction(
  rawEventType: string,
): TransactionMapping | null {
  return isProviderEventType(rawEventType)
    ? EVENT_TO_TRANSACTION[rawEventType]
    : null;
}
