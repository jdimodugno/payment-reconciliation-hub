import {
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  timestamp,
  uuid,
  varchar,
  unique,
} from 'drizzle-orm/pg-core';
import { providersTable } from '../providers/provider.schema';

export const transactionStatusEnum = pgEnum('transactionStatus', [
  'pending',
  'settled',
  'failed',
  'reversed',
]);
export const transactionTypeEnum = pgEnum('transactionType', [
  'payin',
  'payout',
]);

export const transactionsTable = pgTable(
  'transactions',
  {
    id: uuid().primaryKey().defaultRandom(),
    externalId: varchar().notNull(),
    providerId: uuid()
      .references(() => providersTable.id)
      .notNull(),
    amount: numeric({ precision: 38, scale: 18 }).notNull(),
    currency: varchar({ length: 8 }).notNull(),
    status: transactionStatusEnum().notNull(),
    type: transactionTypeEnum().notNull(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    metadata: jsonb(),
  },
  (table) => [
    unique('transactions_provider_external_uq').on(
      table.providerId,
      table.externalId,
    ),
  ],
);
