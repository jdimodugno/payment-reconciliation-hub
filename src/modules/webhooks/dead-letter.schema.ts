import { pgTable, uuid, varchar, text, timestamp } from 'drizzle-orm/pg-core';
import { webhooksTable } from './webhook.schema';

// ADR-011: dead-letter como tabla de dominio ANEXA (append-only).
// Invariante: APUNTA a webhook_events (event_id FK), NO copia su estado.
// `webhook_events.status` sigue siendo la única fuente de verdad del estado;
// acá vive SOLO el contexto de la muerte (reason / last_error / failed_at).
// SIN unique sobre event_id: N filas por evento = audit trail de cada fallo /
// reintento manual. El último da la foto actual.
export const deadLetterEventsTable = pgTable('dead_letter_events', {
  id: uuid().primaryKey().defaultRandom().notNull(),
  eventId: uuid()
    .references(() => webhooksTable.id)
    .notNull(),
  reason: varchar({ length: 30 }).notNull(),
  lastError: text(),
  failedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
});
