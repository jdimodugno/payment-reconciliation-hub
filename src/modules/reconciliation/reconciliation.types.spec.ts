import { Money } from '@/shared/money/money';
import { Currencies } from '@/shared/money/currency';
import {
  AmountMismatch,
  StateMismatch,
  MissingInternal,
  MissingProvider,
  Discrepancy,
} from './reconciliation.types';
import { transactionStatusEnum } from '../transactions/transaction.schema';

/**
 * Spec del MODELO (no de comportamiento de negocio). Prueba 3 cosas:
 *  1) Positivo: cada variante válida se puede construir (compila).
 *  2) Negativo: los estados ilegales NO compilan (el @ts-expect-error lo garantiza).
 *  3) Runtime: el narrowing por `kind` funciona y el switch es exhaustivo.
 *
 * Nota: los negativos están escritos de forma ROBUSTA AL FORMATTER — el error de tipo
 * cae siempre en la línea que lleva la directiva, sin depender de que algo quede en 1 línea.
 */

// ─── 1. POSITIVO: fixtures válidas (si compilan, lo legal es representable) ───
const amount: AmountMismatch = {
  kind: 'amount_mismatch',
  internalId: 'tx_1',
  providerRef: 'evt_1',
  internalAmount: Money.fromMinorUnits(2000, Currencies.USD),
  providerAmount: Money.fromMinorUnits(20000, Currencies.USD),
};

const state: StateMismatch = {
  kind: 'state_mismatch',
  internalId: 'tx_2',
  providerRef: 'evt_2',
  internalStatus: transactionStatusEnum.enumValues[0],
  providerStatus: 'pending',
};

const missingInternal: MissingInternal = {
  kind: 'missing_internal',
  providerRef: 'evt_3',
  providerAmount: Money.fromMinorUnits(20000, Currencies.USD),
  providerStatus: 'cancelled',
};

const missingProvider: MissingProvider = {
  kind: 'missing_provider',
  internalId: 'tx_4',
  internalAmount: Money.fromMinorUnits(2000, Currencies.USD),
  internalStatus: transactionStatusEnum.enumValues[0],
};

// @ts-expect-error missing_internal no expone internalId (existe solo en el provider)
void missingInternal.internalId;
// @ts-expect-error missing_provider no expone providerRef (existe solo en interno)
void missingProvider.providerRef;

const check = <T>(_x: T): void => {};
// @ts-expect-error amount_mismatch requiere providerAmount
check<AmountMismatch>({
  kind: 'amount_mismatch',
  internalId: 'i',
  providerRef: 'e',
  internalAmount: Money.fromMinorUnits(1, Currencies.USD),
});
// @ts-expect-error kind inexistente no es asignable a Discrepancy
check<Discrepancy>({ kind: 'foo' });

function assertNever(x: never): never {
  throw new Error(`Unhandled discrepancy kind: ${JSON.stringify(x)}`);
}

function summarize(d: Discrepancy): string {
  switch (d.kind) {
    case 'amount_mismatch':
      return `amount ${d.internalAmount.toString()} vs ${d.providerAmount.toString()}`;
    case 'state_mismatch':
      return `state ${d.internalStatus} vs ${d.providerStatus}`;
    case 'missing_internal':
      return `missing internal for ${d.providerRef}`;
    case 'missing_provider':
      return `missing provider for ${d.internalId}`;
    default:
      return assertNever(d);
  }
}

describe('Discrepancy model', () => {
  it('narrows each variant by kind', () => {
    expect(summarize(state)).toBe('state pending vs pending');
    expect(summarize(missingInternal)).toBe('missing internal for evt_3');
    expect(summarize(missingProvider)).toBe('missing provider for tx_4');
    expect(summarize(amount)).toContain('amount');
  });
});
