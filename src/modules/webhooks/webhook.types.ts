import { webhookEventStatusEnum } from './webhook.schema';

export enum PendingManualReviewReason {
  UNSUPPORTED_CURRENCY = 'unsupported_currency',
  RETRIES_EXHAUSTED = 'retries_exhausted',
  UNSUPPORTED_EVENT_TYPE = 'unsupported_event_type',
}

export type WebhookEventStatus =
  (typeof webhookEventStatusEnum.enumValues)[number];

export type ProcessWebhookEventResultStatus =
  | 'failed'
  | 'processed'
  | 'already_processed';

export type ProcessWebhookEventResult = {
  status: ProcessWebhookEventResultStatus;
};

export type WebhookEvent = {
  id: string;
  providerId: string;
  payload: unknown;
  externalEventId: string;
  status: WebhookEventStatus;
  retries: number;
  receivedAt: string;
  processedAt: string | null;
  transactionId: string | null;
  reason: string | null;
};

export type UnprocessedEventRow = {
  id: string;
  receivedAt: Date;
};

export type UnprocessedEvent = Omit<UnprocessedEventRow, 'receivedAt'> & {
  receivedAt: string;
  ageInDays: number;
};
