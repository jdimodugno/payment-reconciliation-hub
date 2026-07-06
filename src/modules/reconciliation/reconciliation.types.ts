import { Money } from '@/shared/money/money';
import { DiscrepancyKind } from './reconciliation.schema';
import { TransactionStatus } from '../transactions/transaction.types';

export type BaseMismatch = {
  detectedAt: string;
};

type ExistsInBoth = {
  internalId: string;
  providerRef: string;
};

export type AmountMismatch = BaseMismatch &
  ExistsInBoth & {
    kind: Extract<DiscrepancyKind, 'amount_mismatch'>;
    providerAmount: Money;
    internalAmount: Money;
  };

export type StateMismatch = BaseMismatch &
  ExistsInBoth & {
    kind: Extract<DiscrepancyKind, 'state_mismatch'>;
    providerStatus: string;
    internalStatus: TransactionStatus;
  };

export type MissingInternal = BaseMismatch & {
  kind: Extract<DiscrepancyKind, 'missing_internal'>;
  providerRef: string;
  providerAmount: Money;
  providerStatus: string;
};

export type MissingProvider = BaseMismatch & {
  kind: Extract<DiscrepancyKind, 'missing_provider'>;
  internalId: string;
  internalAmount: Money;
  internalStatus: TransactionStatus;
};

export type Discrepancy =
  | AmountMismatch
  | StateMismatch
  | MissingInternal
  | MissingProvider;

type AllKindsCovered = DiscrepancyKind extends Discrepancy['kind']
  ? true
  : false;

type Expect<T extends true> = T;
type _AssertExhaustive = Expect<AllKindsCovered>;

export type StoredDiscrepancy = Discrepancy & { id: string };
