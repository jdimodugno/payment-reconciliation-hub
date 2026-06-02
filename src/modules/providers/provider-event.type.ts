export type ProviderEventType =
  | 'payment.succeeded'
  | 'payment.failed'
  | 'payment.refunded';

export type RawProviderEvent = {
  externalEventId: string;
  externalId: string;
  type: ProviderEventType;
  rawEventData: string;
};

export type EnrichedProviderEvent = RawProviderEvent & {
  amount: string;
  currency: string;
};
