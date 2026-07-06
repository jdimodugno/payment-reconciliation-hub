import {
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  timestamp,
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

export const discrepanciesTable = pgTable('discrepancies', {
  id: uuid().primaryKey().defaultRandom().notNull(),
  kind: discrepancyKindEnum().notNull(),
  internalId: uuid(),
  providerRef: varchar(),
  delta: numeric({ precision: 38, scale: 18 }),
  status: discrepancyStatusEnum().notNull().default('unresolved'),
  detectedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  payload: jsonb().notNull(),
});

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
