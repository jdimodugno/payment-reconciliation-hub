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

export const discrepancyStatusEnum = pgEnum('discrepancyStatus', [
  'unresolved',
  'resolved',
  'dismissed',
]);

export const discrepanciesTable = pgTable(
  'discrepancies',
  {
    id: uuid().primaryKey().defaultRandom().notNull(),
    kind: discrepancyKindEnum().notNull(),
    internalId: uuid(),
    providerRef: varchar(),
    delta: numeric({ precision: 38, scale: 18 }),
    status: discrepancyStatusEnum().notNull().default('unresolved'),
    detectedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    payload: jsonb().notNull(),
  },
  (table) => [
    // Árbitro de idempotencia del batch: un re-run sobre el mismo par + dimensión
    // NO duplica. nullsNotDistinct() hace que dos NULL colisionen (PG15+), así los
    // casos missing_* (un lado ausente = NULL) también quedan protegidos.
    // Costo asumido (ADR-013): lock a PG15+, umbral de migración alto.
    unique('discrepancies_pair_kind_uk')
      .on(table.internalId, table.providerRef, table.kind)
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
