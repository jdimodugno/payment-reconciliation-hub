import { LogSerializer } from '@/shared/logging/log-serializer.interface';

export type DeadLetterEventData = {
  eventId: string;
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
