import { Money } from '@/shared/money/money';

export type BaseMismatch = {
  internalId: string;
  providerRef: string;
  detectedAt: string;
};

export type AmountMismatch = BaseMismatch & {
  kind: 'amount_mismatch';
  providerAmount: Money;
  internalAmount: Money;
};

export type StateMismatch = BaseMismatch & {
  kind: 'state_mismatch';
  providerStatus: string;
  internalStatus: string;
};

export type MissingInternal = Omit<BaseMismatch, 'internalId'> & {
  kind: 'missing_internal';
};

export type MissingProvider = Omit<BaseMismatch, 'providerRef'> & {
  kind: 'missing_provider';
};

export type Discrepancy =
  | AmountMismatch
  | StateMismatch
  | MissingInternal
  | MissingProvider;
