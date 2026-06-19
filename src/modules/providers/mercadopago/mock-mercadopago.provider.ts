import { Money } from '@/shared/money/money';
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
import { NotFoundInExternalSourceError } from '@/shared/exception/not-found-external-source.exception';
import { MalformedProviderEventError } from '@/modules/webhooks/webhook.exception';

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

type FakeMPObject = {
  id: string;
  amount: number;
  currency: string;
  status: string;
};

const MOCK_NOT_FOUND_ID = 'mp_notfound_123';

const fakeFetchMercadoPagoTxDetail = async (
  txId: string,
): Promise<FakeMPObject> => {
  if (!txId) throw new Error('Id is required for tx detail fetching');
  if (txId === MOCK_NOT_FOUND_ID) {
    throw new NotFoundInExternalSourceError(txId, 'MERCADO_PAGO');
  }
  const mockedMPData = {
    id: '99999999',
    amount: 123,
    currency: 'usd',
    status: 'success',
  };
  return mockedMPData;
};

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
    const txData = await fakeFetchMercadoPagoTxDetail(
      rawEvent.rawEventData.data.id,
    );

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
