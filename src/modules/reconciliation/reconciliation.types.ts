import { Money } from '@/shared/money/money';
import { DiscrepancyKind } from './reconciliation.schema';
import { TransactionStatus } from '../transactions/transaction.types';

type ExistsInBoth = {
  internalId: string;
  providerRef: string;
};

export type AmountMismatch = ExistsInBoth & {
  kind: Extract<DiscrepancyKind, 'amount_mismatch'>;
  providerAmount: Money;
  internalAmount: Money;
};

export type StateMismatch = ExistsInBoth & {
  kind: Extract<DiscrepancyKind, 'state_mismatch'>;
  providerStatus: string;
  internalStatus: TransactionStatus;
};

export type MissingInternal = {
  kind: Extract<DiscrepancyKind, 'missing_internal'>;
  providerRef: string;
  providerAmount: Money;
  providerStatus: string;
};

export type MissingProvider = {
  kind: Extract<DiscrepancyKind, 'missing_provider'>;
  internalId: string;
  internalAmount: Money;
  internalStatus: TransactionStatus;
};

// Write-side: el hecho detectado ANTES de persistir. No tiene id ni detectedAt
// porque ambos los posee la DB (id = defaultRandom, detectedAt = defaultNow).
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

// Read-side: lo que volvés a leer de la DB. id + detectedAt los agrega la
// persistencia (DB-owner), no el dominio que detecta la discrepancia.
export type StoredDiscrepancy = Discrepancy & {
  id: string;
  detectedAt: string;
};

// Resultado de UNA corrida (ADR-017). `scanned` va explícito porque un run con
// cero discrepancias sobre cero datos y uno sobre miles de pares se leen igual
// mirando sólo el conteo de hallazgos, y no significan lo mismo.
export type ReconciliationRunResult = {
  runId: string;
  scanned: { internal: number; provider: number; unreadable: number };
  discrepancies: number;
  byKind: Record<DiscrepancyKind, number>;
};
