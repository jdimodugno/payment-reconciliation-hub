export type WebhookEvent = {
  id: string;
  providerId: string;
  payload: unknown;
  externalEventId: string;
  status: 'received' | 'processing' | 'processed' | 'failed';
  retries: number;
  receivedAt: string;
  processedAt: string | null;
  transactionId: string | null;
};
