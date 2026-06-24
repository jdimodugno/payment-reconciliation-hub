import {
  pgTable,
  uuid,
  varchar,
  integer,
  timestamp,
  pgEnum,
  jsonb,
  unique,
} from 'drizzle-orm/pg-core';
import { providersTable } from '../providers/provider.schema';
import { transactionsTable } from '../transactions/transaction.schema';

export const webhookEventStatusEnum = pgEnum('webhookEventStatus', [
  'received',
  'processed',
  'pending_manual_review',
]);

export const webhooksTable = pgTable(
  'webhook_events',
  {
    id: uuid().primaryKey().defaultRandom().notNull(),
    providerId: uuid()
      .references(() => providersTable.id)
      .notNull(),
    payload: jsonb().notNull(),
    externalEventId: varchar().notNull(),
    status: webhookEventStatusEnum().notNull().default('received'),
    retries: integer().notNull().default(0),
    receivedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    processedAt: timestamp({ withTimezone: true }),
    transactionId: uuid().references(() => transactionsTable.id),
    // ADR-011: `reason` se movió a dead_letter_events (el anexo apunta, no copia).
    // webhook_events conserva SOLO el estado (status) como fuente de verdad.
  },
  (table) => [
    unique('webhook_events_provider_event_uk').on(
      table.providerId,
      table.externalEventId,
    ),
  ],
);
