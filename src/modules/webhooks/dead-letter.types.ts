import { LogSerializer } from '@/shared/logging/log-serializer.interface';

export type DeadLetterEventData = {
  eventId: string;
  // Generación en la que ocurrió esta muerte = `webhook_events.retries` al morir.
  // Es lo que distingue una muerte de otra (ver el árbitro en dead-letter.schema).
  generation: number;
  reason: string;
  lastError: string | null;
};

export type DeadLetterEvent = DeadLetterEventData & {
  id: string;
  failedAt: string;
};

export const deadLetterEventSerializer: LogSerializer<DeadLetterEventData> = {
  name: 'DeadLetterEvent',
  allowlist: ['eventId', 'reason'],
};
