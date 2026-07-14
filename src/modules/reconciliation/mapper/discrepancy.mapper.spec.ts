import { Money } from '@/shared/money/money';
import {
  AmountMismatch,
  MissingInternal,
  MissingProvider,
  StateMismatch,
  StoredDiscrepancy,
} from '../reconciliation.types';
import {
  DiscrepancyRow,
  fromRow,
  requiredProperty,
  toRow,
} from './discrepancy.mapper';
import { Currencies } from '@/shared/money/currency';

function throughJsonb(payload: unknown): unknown {
  return JSON.parse(JSON.stringify(payload));
}

function asStoredRow(
  newRow: ReturnType<typeof toRow>,
  overrides: { id: string; detectedAt: Date },
): DiscrepancyRow {
  return {
    id: overrides.id,
    detectedAt: overrides.detectedAt,
    status: 'unresolved',
    internalId: newRow.internalId ?? null,
    providerRef: newRow.providerRef ?? null,
    delta: newRow.delta ?? null,
    kind: newRow.kind,
    payload: throughJsonb(newRow.payload),
  };
}

describe('discrepancy.mapper', () => {
  describe('round-trip (toRow -> fromRow)', () => {
    it('amount_mismatch sobrevive el viaje a la fila y de vuelta', () => {
      const detectedAt = '2026-07-07T10:00:00.000Z';
      const original: AmountMismatch = {
        kind: 'amount_mismatch',
        internalId: 'int-1',
        providerRef: 'prov-1',
        internalAmount: Money.fromDecimal('100.00', Currencies.USD),
        providerAmount: Money.fromDecimal('105.00', Currencies.USD),
      };

      const row = toRow(original);
      const stored = asStoredRow(row, {
        id: 'disc-1',
        detectedAt: new Date(detectedAt),
      });
      const back = fromRow(stored) as StoredDiscrepancy & AmountMismatch;

      expect(back.kind).toBe('amount_mismatch');
      expect(back.internalAmount.toDecimal()).toBe(
        original.internalAmount.toDecimal(),
      );
      expect(back.internalAmount.getCurrency()).toBe(
        original.internalAmount.getCurrency(),
      );
      expect(back.providerAmount.toDecimal()).toBe(
        original.providerAmount.toDecimal(),
      );
      expect(back.providerAmount.getCurrency()).toBe(
        original.providerAmount.getCurrency(),
      );
      expect(original.internalId).toBe(back.internalId);
      expect(original.providerRef).toBe(back.providerRef);
      expect(back.detectedAt).toBe(detectedAt);
    });

    it('state_mismatch sobrevive el viaje a la fila y de vuelta', () => {
      const detectedAt = '2026-07-07T10:00:00.000Z';
      const original: StateMismatch = {
        kind: 'state_mismatch',
        internalId: 'int-1',
        providerRef: 'prov-1',
        internalStatus: 'settled',
        providerStatus: 'payment.succeeded',
      };

      const stored = asStoredRow(toRow(original), {
        id: 'disc-2',
        detectedAt: new Date(detectedAt),
      });
      const back = fromRow(stored) as StoredDiscrepancy & StateMismatch;

      expect(back.kind).toBe('state_mismatch');
      expect(back.internalStatus).toBe(original.internalStatus);
      expect(back.providerStatus).toBe(original.providerStatus);
      expect(back.internalId).toBe(original.internalId);
      expect(back.providerRef).toBe(original.providerRef);
      expect(back.detectedAt).toBe(detectedAt);
    });

    it('missing_internal sobrevive el viaje a la fila y de vuelta', () => {
      const detectedAt = '2026-07-07T10:00:00.000Z';
      const original: MissingInternal = {
        kind: 'missing_internal',
        providerRef: 'prov-1',
        providerAmount: Money.fromDecimal('105.00', Currencies.USD),
        providerStatus: 'payment.succeeded',
      };

      const stored = asStoredRow(toRow(original), {
        id: 'disc-3',
        detectedAt: new Date(detectedAt),
      });
      const back = fromRow(stored) as StoredDiscrepancy & MissingInternal;

      expect(back.kind).toBe('missing_internal');
      expect(back.providerAmount.toDecimal()).toBe(
        original.providerAmount.toDecimal(),
      );
      expect(back.providerAmount.getCurrency()).toBe(
        original.providerAmount.getCurrency(),
      );
      expect(back.providerStatus).toBe(original.providerStatus);
      expect(back.providerRef).toBe(original.providerRef);
      expect(back.detectedAt).toBe(detectedAt);
    });

    it('missing_provider sobrevive el viaje a la fila y de vuelta', () => {
      const detectedAt = '2026-07-07T10:00:00.000Z';
      const original: MissingProvider = {
        kind: 'missing_provider',
        internalId: 'int-1',
        internalAmount: Money.fromDecimal('100.00', Currencies.USD),
        internalStatus: 'settled',
      };

      const stored = asStoredRow(toRow(original), {
        id: 'disc-4',
        detectedAt: new Date(detectedAt),
      });
      const back = fromRow(stored) as StoredDiscrepancy & MissingProvider;

      expect(back.kind).toBe('missing_provider');
      expect(back.internalAmount.toDecimal()).toBe(
        original.internalAmount.toDecimal(),
      );
      expect(back.internalAmount.getCurrency()).toBe(
        original.internalAmount.getCurrency(),
      );
      expect(back.internalStatus).toBe(original.internalStatus);
      expect(back.internalId).toBe(original.internalId);
      expect(back.detectedAt).toBe(detectedAt);
    });
  });

  describe('required (guard de columna)', () => {
    it('tira si una columna esperada vino null (fila corrupta)', () => {
      // TODO(juan): assert que required(null, 'internalId') tira.
      expect(() => requiredProperty(null, 'internalId')).toThrow();
      expect(() => requiredProperty(null, 'internalAmount')).toThrow();
    });
  });
});
