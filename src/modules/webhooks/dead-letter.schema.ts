import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  integer,
  unique,
} from 'drizzle-orm/pg-core';
import { webhooksTable } from './webhook.schema';

// ADR-011: dead-letter como tabla de dominio ANEXA (append-only).
// Invariante: APUNTA a webhook_events (event_id FK), NO copia su estado.
// `webhook_events.status` sigue siendo la única fuente de verdad del estado;
// acá vive SOLO el contexto de la muerte (reason / last_error / failed_at).
//
// ENMIENDA (ADR-011 → d31): el "SIN unique sobre event_id" original era correcto
// mientras la ÚNICA forma de generar N filas fuese morir N veces. Dejó de serlo:
// con `append` propagando (ADR-016), BullMQ reintenta la transición entera hasta
// 3 veces, y esos reintentos son LA MISMA muerte. Sin árbitro, el anexo mezcla
// "veces que murió" con "veces que registramos una muerte" — y ADR-015 usa ese
// número como número de intento.
//
// Clave natural de una muerte: dos muertes están separadas por exactamente un
// flip de reactivación (ADR-015), nunca por tiempo ni por mensaje de error. Por
// eso el árbitro es (event_id, generation), donde `generation` es el valor de
// `webhook_events.retries` AL MORIR.
//
// `generation` no viola el invariante de ADR-011: no es estado vivo copiado —
// `webhook_events.retries` sigue siendo la fuente de verdad de cuántas veces se
// reactivó el evento. Acá queda CONGELADO el hecho de en qué generación ocurrió
// esta muerte, que ya no cambia nunca. Misma naturaleza que `failed_at`.
export const deadLetterEventsTable = pgTable(
  'dead_letter_events',
  {
    id: uuid().primaryKey().defaultRandom().notNull(),
    eventId: uuid()
      .references(() => webhooksTable.id)
      .notNull(),
    generation: integer().notNull(),
    reason: varchar({ length: 30 }).notNull(),
    lastError: text(),
    failedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('dead_letter_events_event_generation_uk').on(
      table.eventId,
      table.generation,
    ),
  ],
);
