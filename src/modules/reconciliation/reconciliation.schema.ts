import {
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const discrepancyKindEnum = pgEnum('discrepancyKind', [
  'amount_mismatch',
  'state_mismatch',
  'missing_internal',
  'missing_provider',
]);

export type DiscrepancyKind = (typeof discrepancyKindEnum.enumValues)[number];

// ADR-017 D4: una fila es una OBSERVACIÓN, no el problema.
//
// El árbitro original (internalId, providerRef, kind) se diseñó cuando el batch
// NUNCA había corrido: ahí un conflicto significaba una sola cosa —"mismo estado,
// re-run, converge". Con el shell corriendo en el tiempo pasó a significar DOS:
// "ya la vi, no cambió" (descartar es correcto) y "ya la vi, y CAMBIÓ" (descartar
// es pérdida de datos). `onConflictDoNothing` las trataba igual, así que una fila
// podía decir "resuelta, $10" mientras producción divergía por $5000.
//
// `runId` mete la corrida en la clave: cada corrida registra lo que vio, y dos
// observaciones del mismo par+dimensión en corridas distintas conviven. "Qué está
// roto AHORA" se contesta con la última observación por (par, kind).
//
// `status` se fue: resolver es una propiedad del PROBLEMA, no de una observación
// —una observación pasada no se "resuelve", ya ocurrió— y hoy no hay ningún
// consumidor que resuelva nada. El modelo problema/observación en dos tablas entra
// cuando exista quien resuelva (ADR-017 D4, alternativa no elegida).
export const discrepanciesTable = pgTable(
  'discrepancies',
  {
    id: uuid().primaryKey().defaultRandom().notNull(),
    runId: uuid().notNull(),
    kind: discrepancyKindEnum().notNull(),
    internalId: uuid(),
    providerRef: varchar(),
    delta: numeric({ precision: 38, scale: 18 }),
    detectedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    payload: jsonb().notNull(),
  },
  (table) => [
    // Idempotencia DENTRO de una corrida: si la misma corrida reintenta, no
    // duplica. nullsNotDistinct() hace que dos NULL colisionen (PG15+), así los
    // casos missing_* (un lado ausente = NULL) también quedan protegidos.
    // Costo asumido (ADR-013): lock a PG15+, umbral de migración alto.
    unique('discrepancies_run_pair_kind_uk')
      .on(table.runId, table.internalId, table.providerRef, table.kind)
      .nullsNotDistinct(),
  ],
);

// Columnas
// - id — uuid/serial, PK
// - kind — enum (amount | state | missing_internal | missing_provider)
// - paymentId (externalId) — el par comparado
// - delta — numeric (exacto, T1), nullable (solo amount)
// - status — enum (unresolved | resolved | dismissed)
// - detectedAt — timestamptz
// - payload — jsonb

// jsonb (payload), por variante
// - amount: internalAmount, providerAmount, currency (strings decimales)
// - state: internalState, providerState
// - missing_internal: lado provider presente (monto/estado/lo que tengas del provider)
// - missing_provider: lado interno presente
