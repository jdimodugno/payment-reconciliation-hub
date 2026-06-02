import { Money } from '@/shared/money/money';
import { PaymentProvider } from '../payment-provider.interface';
import {
  RawProviderEvent,
  ProviderEventType,
  EnrichedProviderEvent,
} from '../provider-event.type';
import { RawStripeEventType, StripeRawPayload } from './stripe-payload.type';

const getType = (rawEventType: RawStripeEventType): ProviderEventType => {
  switch (rawEventType) {
    case 'payment_intent.succeeded':
      return 'payment.succeeded';
    case 'payment_intent.failed':
      return 'payment.failed';
    case 'payment_intent.refunded':
      return 'payment.refunded';
  }
};

export const isStripeWebhook = (
  payload: unknown,
): payload is StripeRawPayload =>
  payload !== null &&
  typeof payload === 'object' &&
  'id' in payload &&
  typeof payload.id === 'string' &&
  'object' in payload &&
  'type' in payload &&
  typeof payload.type === 'string' &&
  (payload.type === 'payment_intent.succeeded' ||
    payload.type === 'payment_intent.failed' ||
    payload.type === 'payment_intent.refunded') &&
  'data' in payload &&
  payload.data !== null &&
  typeof payload.data === 'object' &&
  'object' in payload.data &&
  typeof payload.data.object === 'object' &&
  payload.data.object !== null &&
  'id' in payload.data.object &&
  typeof payload.data.object.id === 'string' &&
  typeof payload.data.object.id === 'string' &&
  'currency' in payload.data.object &&
  payload.data.object.currency !== null &&
  typeof payload.data.object.currency === 'string' &&
  'amount' in payload.data.object &&
  payload.data.object.amount !== null &&
  typeof payload.data.object.amount === 'number';

export class MockStripeProvider implements PaymentProvider {
  name = 'MOCK_STRIPE';

  parseWebhook(payload: unknown): RawProviderEvent {
    if (!isStripeWebhook(payload)) {
      throw new Error(
        `Unable to parse webhook event from provider - ${this.name}}`,
      );
    }

    return {
      externalId: payload.data.object.id,
      externalEventId: payload.id,
      type: getType(payload.type),
      rawEventData: JSON.stringify(payload),
    };
  }

  async fetchDetails(
    rawEvent: RawProviderEvent,
  ): Promise<EnrichedProviderEvent> {
    const parsedRawEventData = JSON.parse(rawEvent.rawEventData);
    if (!isStripeWebhook(parsedRawEventData)) {
      throw new Error('Unable to parse webhook event from provider');
    }

    return {
      ...rawEvent,
      amount: Money.fromMinorUnits(
        parsedRawEventData.data.object.amount,
        parsedRawEventData.data.object.currency,
      ).toDecimal(),
      currency: parsedRawEventData.data.object.currency,
    };
  }
}
