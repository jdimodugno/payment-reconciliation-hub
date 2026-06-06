export type NewWebhookEvent = {
  providerId: string;
  externalEventId: string;
  payload: Record<string, unknown>;
  status: 'received' | 'processing' | 'processed' | 'failed';
};
