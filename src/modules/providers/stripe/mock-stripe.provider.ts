import { Money } from '@/shared/money/money';
import { PaymentProvider } from '../payment-provider.interface';
import {
  RawProviderEvent,
  ProviderEventType,
  EnrichedProviderEvent,
} from '../provider-event.type';
import {
  RawStripeEventType,
  StripeEnrichedPayload,
  StripeRawPayload,
} from './stripe-payload.type';
import { BadRequestException } from '@nestjs/common';

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
  'data' in payload &&
  payload.data !== null &&
  typeof payload.data === 'object' &&
  'object' in payload.data &&
  typeof payload.data.object === 'object' &&
  payload.data.object !== null &&
  'id' in payload.data.object &&
  typeof payload.data.object.id === 'string';

export const isProcessableStripeEvent = (
  payload: object,
): payload is StripeEnrichedPayload =>
  isStripeWebhook(payload) &&
  'type' in payload &&
  (payload.type === 'payment_intent.succeeded' ||
    payload.type === 'payment_intent.failed' ||
    payload.type === 'payment_intent.refunded') &&
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
      throw new BadRequestException(
        `Unable to parse webhook event from provider - ${this.name}`,
      );
    }

    return {
      externalId: payload.data.object.id,
      externalEventId: payload.id,
      rawEventData: payload,
    };
  }

  async fetchDetails(
    rawEvent: RawProviderEvent,
  ): Promise<EnrichedProviderEvent> {
    if (!isProcessableStripeEvent(rawEvent.rawEventData)) {
      throw new BadRequestException(
        `Unable to process webhook event from provider - ${this.name}`,
      );
    }

    return {
      ...rawEvent,
      type: getType(rawEvent.rawEventData.type),
      amount: Money.fromMinorUnits(
        rawEvent.rawEventData.data.object.amount,
        rawEvent.rawEventData.data.object.currency,
      ).toDecimal(),
      currency: rawEvent.rawEventData.data.object.currency,
    };
  }
}
