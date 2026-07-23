import Decimal from 'decimal.js';
import { z } from 'zod';
import { Currencies } from '@/shared/money/currency';
import { DiscrepancyKind } from './reconciliation.schema';
import { transactionStatusEnum } from '../transactions/transaction.schema';

/**
 * Valida el CONTENIDO del jsonb `payload` de la tabla `discrepancies`.
 * NO valida columnas (id, kind, internalId, providerRef, delta, status, detectedAt).
 * El discriminante `kind` vive en la columna, no acá: por eso NO usamos
 * z.discriminatedUnion, sino un mapa kind -> schema que `fromRow` indexa
 * con la columna `kind` (decisión (b): fuente única del kind = la columna).
 */

const isDecimalString = (value: string): boolean => {
  try {
    new Decimal(value);
    return true;
  } catch {
    return false;
  }
};

const decimalString = z
  .string()
  .refine(isDecimalString, 'monto decimal inválido');

// currency contra el enum conocido (DRY: reusa Currencies, no re-declares las monedas).
const currency = z.enum(Currencies);

// --- Schemas por variante -----------------------------------------------------

const amountPayload = z.object({
  internalAmount: decimalString,
  providerAmount: decimalString,
  currency,
});

const statePayload = z.object({
  internalStatus: z.enum(transactionStatusEnum.enumValues),
  providerStatus: z.string(),
});

const missingInternalPayload = z.object({
  providerAmount: decimalString,
  currency,
  providerStatus: z.string(),
});

const missingProviderPayload = z.object({
  internalAmount: decimalString,
  currency,
  internalStatus: z.enum(transactionStatusEnum.enumValues),
});

// --- Mapa kind -> schema ------------------------------------------------------

// `satisfies Record<DiscrepancyKind, ...>` fuerza cobertura exhaustiva:
// si agregás un kind al pgEnum y te olvidás su schema acá, NO compila.
export const discrepancyPayloadSchemas = {
  amount_mismatch: amountPayload,
  state_mismatch: statePayload,
  missing_internal: missingInternalPayload,
  missing_provider: missingProviderPayload,
} satisfies Record<DiscrepancyKind, z.ZodTypeAny>;

// --- Parse helper (lo usa fromRow) --------------------------------------------

// Indexa el schema por la columna kind y parsea el jsonb crudo.
// Devuelve el payload validado del variante correspondiente.
// TODO(juan): el tipo de retorno acá es la unión de todos los payloads.
//   Vamos a estrecharlo cuando cableemos fromRow (el kind de la columna estrecha el variante).
export function parseDiscrepancyPayload(
  kind: DiscrepancyKind,
  rawPayload: unknown,
) {
  return discrepancyPayloadSchemas[kind].parse(rawPayload);
}
