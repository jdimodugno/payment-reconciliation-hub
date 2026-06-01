import { ProviderEvent } from './provider-event.type';

export interface PaymentProvider {
  name: string;
  parseWebhook: (payload: unknown) => ProviderEvent;
}
