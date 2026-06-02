import { EnrichedProviderEvent, RawProviderEvent } from './provider-event.type';

export interface PaymentProvider {
  name: string;
  parseWebhook: (payload: unknown) => RawProviderEvent;
  fetchDetails: (rawEvent: RawProviderEvent) => Promise<EnrichedProviderEvent>;
}
