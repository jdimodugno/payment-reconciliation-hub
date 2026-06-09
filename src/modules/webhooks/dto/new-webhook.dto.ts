import { WebhookEventStatus } from '../webhook.types';

export type NewWebhookEvent = {
  providerId: string;
  externalEventId: string;
  payload: Record<string, unknown>;
  status: WebhookEventStatus;
};
