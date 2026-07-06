import { discrepanciesTable } from '../reconciliation.schema';
import { discrepancyPayloadSchemas } from '../reconciliation.payload';
import { Discrepancy, StoredDiscrepancy } from '../reconciliation.types';
import Decimal from 'decimal.js';
import { Money } from '@/shared/money/money';

export type DiscrepancyRow = typeof discrepanciesTable.$inferSelect;
export type NewDiscrepancyRow = typeof discrepanciesTable.$inferInsert;

export function toRow(discrepancy: Discrepancy): NewDiscrepancyRow {
  switch (discrepancy.kind) {
    case 'amount_mismatch':
      return {
        kind: discrepancy.kind,
        internalId: discrepancy.internalId,
        providerRef: discrepancy.providerRef,
        payload: {
          internalAmount: discrepancy.internalAmount.toDecimal(),
          providerAmount: discrepancy.providerAmount.toDecimal(),
          currency: discrepancy.internalAmount.getCurrency(),
        },
        delta: new Decimal(discrepancy.providerAmount.toDecimal())
          .sub(new Decimal(discrepancy.internalAmount.toDecimal()))
          .toString(),
      };
    case 'state_mismatch':
      return {
        kind: discrepancy.kind,
        internalId: discrepancy.internalId,
        providerRef: discrepancy.providerRef,
        payload: {
          internalStatus: discrepancy.internalStatus,
          providerStatus: discrepancy.providerStatus,
        },
      };
    case 'missing_internal':
      return {
        kind: discrepancy.kind,
        providerRef: discrepancy.providerRef,
        payload: {
          providerAmount: discrepancy.providerAmount.toDecimal(),
          providerStatus: discrepancy.providerStatus,
          currency: discrepancy.providerAmount.getCurrency(),
        },
      };
    case 'missing_provider':
      return {
        kind: discrepancy.kind,
        internalId: discrepancy.internalId,
        payload: {
          internalAmount: discrepancy.internalAmount.toDecimal(),
          internalStatus: discrepancy.internalStatus,
          currency: discrepancy.internalAmount.getCurrency(),
        },
      };
  }
}

export function requiredProperty(value: string | null, field: string): string {
  if (value === null)
    throw new Error(`Discrepancy row corrupta: ${field} ausente`);
  return value; // TS lo estrecha a string
}

// Fila -> dominio. T1: Money.fromDecimal(string, currency), nunca number.
// El .parse por variante devuelve el payload YA estrechado (sin magia de tipos).
export function fromRow(row: DiscrepancyRow): StoredDiscrepancy {
  switch (row.kind) {
    case 'amount_mismatch': {
      const p = discrepancyPayloadSchemas.amount_mismatch.parse(row.payload);
      return {
        id: row.id,
        kind: row.kind,
        providerAmount: Money.fromDecimal(p.providerAmount, p.currency),
        detectedAt: row.detectedAt.toISOString(),
        internalAmount: Money.fromDecimal(p.internalAmount, p.currency),
        providerRef: requiredProperty(row.providerRef, 'providerRef'),
        internalId: requiredProperty(row.internalId, 'internalId'),
      };
    }
    case 'state_mismatch': {
      const p = discrepancyPayloadSchemas.state_mismatch.parse(row.payload);
      return {
        id: row.id,
        kind: row.kind,
        detectedAt: row.detectedAt.toISOString(),
        providerStatus: p.providerStatus,
        internalStatus: p.internalStatus,
        providerRef: requiredProperty(row.providerRef, 'providerRef'),
        internalId: requiredProperty(row.internalId, 'internalId'),
      };
    }
    case 'missing_internal': {
      const p = discrepancyPayloadSchemas.missing_internal.parse(row.payload);
      return {
        id: row.id,
        kind: row.kind,
        detectedAt: row.detectedAt.toISOString(),
        providerStatus: p.providerStatus,
        providerAmount: Money.fromDecimal(p.providerAmount, p.currency),
        providerRef: requiredProperty(row.providerRef, 'providerRef'),
      };
    }
    case 'missing_provider': {
      const p = discrepancyPayloadSchemas.missing_provider.parse(row.payload);
      return {
        id: row.id,
        kind: row.kind,
        detectedAt: row.detectedAt.toISOString(),
        internalStatus: p.internalStatus,
        internalAmount: Money.fromDecimal(p.internalAmount, p.currency),
        internalId: requiredProperty(row.internalId, 'internalId'),
      };
    }
  }
}
