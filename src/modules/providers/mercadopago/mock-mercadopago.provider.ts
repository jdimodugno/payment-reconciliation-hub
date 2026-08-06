import { Money } from '@/shared/money/money';
import { isValidCurrency } from '@/shared/money/currency';
import { PaymentProvider } from '../payment-provider.interface';
import {
  RawProviderEvent,
  EnrichedProviderEvent,
  ProviderEventType,
} from '../provider-event.type';
import {
  MercadoPagoEnrichedPayload,
  MercadoPagoRawPayload,
  RawMercadoPagoEventAction,
} from './mercadopago-payload.type';
import { BadRequestException } from '@nestjs/common';
import { fetchMercadoPagoTxDetail } from './mercadopago-tx-detail.client';
import {
  MalformedProviderEventError,
  UnsupportedCurrencyError,
} from '@/modules/webhooks/webhook.exception';

const getType = (
  rawEventType: RawMercadoPagoEventAction,
): ProviderEventType => {
  // TODO: map real status
  switch (rawEventType) {
    case 'payment.created':
      return 'payment.succeeded';
    case 'payment.updated':
      return 'payment.refunded';
  }
};

const isMercadoPagoWebhook = (
  payload: unknown,
): payload is MercadoPagoRawPayload =>
  payload !== null &&
  typeof payload === 'object' &&
  'id' in payload &&
  typeof payload.id === 'number' &&
  'type' in payload &&
  payload.type === 'payment' &&
  'action' in payload &&
  'data' in payload &&
  typeof payload.data === 'object' &&
  payload.data !== null &&
  'id' in payload.data &&
  typeof payload.data.id === 'string';

const isProcessableMercadoPagoEvent = (
  payload: object,
): payload is MercadoPagoEnrichedPayload =>
  isMercadoPagoWebhook(payload) &&
  'action' in payload &&
  (payload.action === 'payment.created' ||
    payload.action === 'payment.updated');

export class MockMercadoPagoProvider implements PaymentProvider {
  name = 'MOCK_MERCADOPAGO';

  parseWebhook(payload: unknown): RawProviderEvent {
    if (!isMercadoPagoWebhook(payload)) {
      throw new BadRequestException(
        `Unable to parse webhook event from provider - ${this.name}`,
      );
    }

    return {
      externalId: payload.data.id,
      externalEventId: payload.id.toString(),
      rawEventData: payload,
    };
  }
  async fetchDetails(
    rawEvent: RawProviderEvent,
  ): Promise<EnrichedProviderEvent> {
    if (!isProcessableMercadoPagoEvent(rawEvent.rawEventData)) {
      throw new MalformedProviderEventError(rawEvent.rawEventData);
    }
    // TODO: real GET /v1/payments/{id}
    const txData = await fetchMercadoPagoTxDetail(
      rawEvent.rawEventData.data.id,
    );

    // Same anti-corruption boundary as the Stripe provider: an unknown currency
    // is rejected as non-retriable here, instead of letting Money throw a plain
    // Error that the consumer would retry three times.
    if (!isValidCurrency(txData.currency)) {
      throw new UnsupportedCurrencyError(txData.currency);
    }

    return {
      ...rawEvent,
      type: getType(rawEvent.rawEventData.action),
      amount: Money.fromDecimal(
        txData.amount.toString(),
        txData.currency,
      ).toDecimal(),
      currency: txData.currency,
    };
  }
}
