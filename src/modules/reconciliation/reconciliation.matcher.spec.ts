import { Money } from '@/shared/money/money';
import {
  InternalSide,
  ProviderSide,
  reconcile,
} from './reconciliation.matcher';

// Helpers: el núcleo puro se prueba con objetos en memoria, sin DB.
const internal = (over: Partial<InternalSide> = {}): InternalSide => ({
  internalId: 'int-1',
  providerId: 'stripe',
  providerRef: 'pi_123',
  amount: Money.fromDecimal('100.00', 'usd'),
  status: 'settled',
  ...over,
});

const provider = (over: Partial<ProviderSide> = {}): ProviderSide => ({
  providerId: 'stripe',
  providerRef: 'pi_123',
  amount: Money.fromDecimal('100.00', 'usd'),
  status: 'settled',
  rawStatus: 'payment.succeeded',
  ...over,
});

describe('reconcile — full outer join + clasificación por variante', () => {
  it('should produce NO discrepancy when a matched pair agrees on amount and state', () => {
    const result = reconcile([internal()], [provider()]);

    expect(result).toEqual([]);
  });

  it('should produce amount_mismatch when a matched pair differs only in amount', () => {
    const result = reconcile(
      [internal({ amount: Money.fromDecimal('100.00', 'usd') })],
      [provider({ amount: Money.fromDecimal('90.00', 'usd') })],
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: 'amount_mismatch',
      internalId: 'int-1',
      providerRef: 'pi_123',
    });
  });

  it('should produce state_mismatch storing the RAW provider status (audit)', () => {
    const result = reconcile(
      [internal({ status: 'settled' })],
      [provider({ status: 'failed', rawStatus: 'payment.failed' })],
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: 'state_mismatch',
      internalStatus: 'settled',
      providerStatus: 'payment.failed',
    });
  });

  it('should produce TWO discrepancies when a pair differs in BOTH amount and state (ADR-013 dec B)', () => {
    const result = reconcile(
      [
        internal({
          amount: Money.fromDecimal('100.00', 'usd'),
          status: 'settled',
        }),
      ],
      [
        provider({
          amount: Money.fromDecimal('90.00', 'usd'),
          status: 'failed',
          rawStatus: 'payment.failed',
        }),
      ],
    );

    expect(result.map((d) => d.kind).sort()).toEqual([
      'amount_mismatch',
      'state_mismatch',
    ]);
  });

  it('should produce missing_internal when the provider has a payment with no internal side', () => {
    const result = reconcile(
      [],
      [provider({ rawStatus: 'payment.succeeded' })],
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: 'missing_internal',
      providerRef: 'pi_123',
      providerStatus: 'payment.succeeded',
    });
  });

  it('should produce missing_provider when we have a transaction with no provider side', () => {
    const result = reconcile([internal()], []);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: 'missing_provider',
      internalId: 'int-1',
      internalStatus: 'settled',
    });
  });

  it('should scope the match by providerId — same providerRef across providers does NOT match', () => {
    const result = reconcile(
      [internal({ providerId: 'stripe', providerRef: 'ref-shared' })],
      [provider({ providerId: 'mercadopago', providerRef: 'ref-shared' })],
    );

    // Sin el providerId en la clave, estos dos se fusionarían en un falso match.
    // Con la clave compuesta, son dos huérfanos: uno de cada lado.
    expect(result.map((d) => d.kind).sort()).toEqual([
      'missing_internal',
      'missing_provider',
    ]);
  });
});
