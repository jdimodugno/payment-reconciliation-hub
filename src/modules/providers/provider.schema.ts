import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
} from 'drizzle-orm/pg-core';

export const providersTable = pgTable('providers', {
  id: uuid().primaryKey().defaultRandom(),
  name: varchar().notNull().unique(),
  type: varchar().notNull(),
  enabled: boolean().default(true).notNull(),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
});
