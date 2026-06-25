export type DeadLetterEventData = {
  eventId: string;
  reason: string;
  lastError: string | null;
};

export type DeadLetterEvent = DeadLetterEventData & {
  id: string;
  failedAt: string;
};

// id: uuid().primaryKey().defaultRandom().notNull(),
// eventId: uuid()
//   .references(() => webhooksTable.id)
//   .notNull(),
// reason: varchar({ length: 30 }).notNull(),
// lastError: text(),
// failedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
