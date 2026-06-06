export type ProviderEventType =
  | 'payment.succeeded'
  | 'payment.failed'
  | 'payment.refunded';

export type RawProviderEvent = {
  externalEventId: string;
  externalId: string;
  rawEventData: Record<string, unknown>;
};

export type EnrichedProviderEvent = RawProviderEvent & {
  amount: string;
  currency: string;
  type: ProviderEventType;
};
