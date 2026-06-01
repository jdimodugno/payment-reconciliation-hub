export type ProviderEventType =
  | 'payment.succeeded'
  | 'payment.failed'
  | 'payment.refunded';

export type ProviderEvent = {
  externalEventId: string;
  externalId: string;
  type: ProviderEventType;
  amount: string;
  currency: string;
  rawEventData: string;
};
