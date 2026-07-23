import { Money } from '@/shared/money/money';
import { TransactionStatus } from '../transactions/transaction.types';
import { Discrepancy } from './reconciliation.types';

/**
 * Functional core de la reconciliación: sin I/O, sin DB, sin dependencias.
 *
 * Los bordes (imperative shell) cargan y normalizan ambos universos a estas
 * formas comparables (amount ya Money, status ya TransactionStatus). Acá adentro
 * solo hay operaciones de conjunto sobre datos en memoria, por eso se testea
 * con arrays y es el corazón auditable del engine.
 */

export type InternalSide = {
  internalId: string;
  providerId: string;
  providerRef: string;
  amount: Money;
  status: TransactionStatus;
};

export type ProviderSide = {
  providerId: string;
  providerRef: string;
  amount: Money;
  // status: eje común de comparación (el shell mapeó type -> TransactionStatus).
  status: TransactionStatus;
  // rawStatus: la señal cruda del provider, se ALMACENA para auditoría
  // (anti-corruption, ADR-013 / decisión d25). Se compara por status, se guarda raw.
  rawStatus: string;
};

/**
 * Clave de emparejamiento: (providerId, providerRef) compuesto.
 * providerRef solo colisionaría entre providers distintos, por eso providerId
 * escopea la clave.
 */
function pairKey(providerId: string, providerRef: string): string {
  return `${providerId}::${providerRef}`;
}

/**
 * Full outer join por clave + clasificación por variante.
 *
 * La discrepancia vive en la diferencia simétrica (solo un lado = missing_*)
 * MÁS los mismatches de la intersección (ambos lados, campos distintos).
 * Recorremos la UNIÓN de claves — no un lado haciendo lookups del otro — porque
 * iterar un solo lado nos cegaría a lo que ese lado no tiene (missing_internal).
 */
export function reconcile(
  internals: InternalSide[],
  providers: ProviderSide[],
): Discrepancy[] {
  const internalByKey = new Map(
    internals.map((i) => [pairKey(i.providerId, i.providerRef), i]),
  );
  const providerByKey = new Map(
    providers.map((p) => [pairKey(p.providerId, p.providerRef), p]),
  );

  const allKeys = new Set([...internalByKey.keys(), ...providerByKey.keys()]);

  const discrepancies: Discrepancy[] = [];
  for (const key of allKeys) {
    discrepancies.push(
      ...comparePair(internalByKey.get(key), providerByKey.get(key)),
    );
  }
  return discrepancies;
}

/**
 * Compara un par por clave y devuelve TODAS sus discrepancias (0, 1 o 2).
 *
 * ADR-013 decisión B: una discrepancia = UNA dimensión de un par. Un par
 * matcheado con monto Y estado distintos produce DOS discrepancias
 * independientes (amount_mismatch + state_mismatch), no una combinada.
 */
function comparePair(
  internal: InternalSide | undefined,
  provider: ProviderSide | undefined,
): Discrepancy[] {
  // Guardas por lo POSITIVO: TS narrowea "provider existe" dentro de cada rama.
  // El caso ambos-undefined es inalcanzable por construcción (toda clave viene
  // de al menos un lado) y cae al return [] final, modelado explícito.
  if (provider && !internal) {
    return [
      {
        kind: 'missing_internal',
        providerRef: provider.providerRef,
        providerAmount: provider.amount,
        providerStatus: provider.rawStatus,
      },
    ];
  }

  if (internal && !provider) {
    return [
      {
        kind: 'missing_provider',
        internalId: internal.internalId,
        internalAmount: internal.amount,
        internalStatus: internal.status,
      },
    ];
  }

  if (!internal || !provider) return [];

  const discrepancies: Discrepancy[] = [];

  if (!internal.amount.equals(provider.amount)) {
    discrepancies.push({
      kind: 'amount_mismatch',
      internalId: internal.internalId,
      providerRef: internal.providerRef,
      internalAmount: internal.amount,
      providerAmount: provider.amount,
    });
  }

  if (internal.status !== provider.status) {
    discrepancies.push({
      kind: 'state_mismatch',
      internalId: internal.internalId,
      providerRef: internal.providerRef,
      internalStatus: internal.status,
      providerStatus: provider.rawStatus,
    });
  }

  return discrepancies;
}
