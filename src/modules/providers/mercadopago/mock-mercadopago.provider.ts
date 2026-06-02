import { Money } from '@/shared/money/money';
import { PaymentProvider } from '../payment-provider.interface';
import {
  RawProviderEvent,
  EnrichedProviderEvent,
  ProviderEventType,
} from '../provider-event.type';
import {
  MercadoPagoPayload,
  RawMercadoPagoEventAction,
} from './mercadopago-payload.type';

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
): payload is MercadoPagoPayload =>
  payload !== null &&
  typeof payload === 'object' &&
  'id' in payload &&
  typeof payload.id === 'number' &&
  'type' in payload &&
  payload.type === 'payment' &&
  'action' in payload &&
  (payload.action === 'payment.created' ||
    payload.action === 'payment.updated') &&
  'data' in payload &&
  typeof payload.data === 'object' &&
  payload.data !== null &&
  'id' in payload.data &&
  typeof payload.data.id === 'string';

type FakeMPObject = {
  id: string;
  amount: number;
  currency: string;
  status: string;
};

const fakeFetchMercadoPagoTxDetail = async (
  txId: string,
): Promise<FakeMPObject> => {
  if (!txId) throw new Error('Id is required for tx detail fetching');
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
      throw new Error(
        `Unable to parse webhook event from provider - ${this.name}`,
      );
    }

    return {
      externalId: payload.data.id,
      externalEventId: payload.id.toString(),
      type: getType(payload.action),
      rawEventData: JSON.stringify(payload),
    };
  }
  async fetchDetails(
    rawEvent: RawProviderEvent,
  ): Promise<EnrichedProviderEvent> {
    const parsedRawEventData = JSON.parse(rawEvent.rawEventData);
    if (!isMercadoPagoWebhook(parsedRawEventData)) {
      throw new Error(
        `Unable to parse webhook event from provider - ${this.name}`,
      );
    }
    // TODO: real GET /v1/payments/{id}
    const txData = await fakeFetchMercadoPagoTxDetail(
      parsedRawEventData.data.id,
    );

    return {
      ...rawEvent,
      amount: Money.fromDecimal(
        txData.amount.toString(),
        txData.currency,
      ).toDecimal(),
      currency: txData.currency,
    };
  }
}
