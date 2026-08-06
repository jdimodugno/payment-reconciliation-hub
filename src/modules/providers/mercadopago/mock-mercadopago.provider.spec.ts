import { UnsupportedCurrencyError } from '@/modules/webhooks/webhook.exception';
import { NonRetriableError } from '@/shared/exception/non-retriable.exception';
import * as txDetailClient from './mercadopago-tx-detail.client';
import { MockMercadoPagoProvider } from './mock-mercadopago.provider';

const provider = new MockMercadoPagoProvider();

const validEventPayload = {
  id: 12345,
  type: 'payment',
  action: 'payment.created',
  data: {
    id: '999999999',
  },
};

describe('MockMercadoPagoProvider.parseWebhook', () => {
  it('parses a valid payload into a ProviderEvent', () => {
    const event = provider.parseWebhook(validEventPayload);

    expect(event.externalId).toEqual('999999999');
    expect(event.externalEventId).toEqual('12345');
  });

  it('throws on a malformed payload', () => {
    expect(() => provider.parseWebhook({ foo: 'bar' })).toThrow();
  });

  it('tolerates an unknown event type at parse, rejects it at enrichment', async () => {
    const unknownTypeEvent = {
      ...validEventPayload,
      action: 'charge.disputed',
    };
    const raw = provider.parseWebhook(unknownTypeEvent);
    expect(raw.externalId).toEqual('999999999');
    expect(raw.externalEventId).toEqual('12345');
    await expect(provider.fetchDetails(raw)).rejects.toThrow();
  });
});

describe('MockMercadoPagoProvider.fetchDetails', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('obtains full detail of a given transaction', async () => {
    const enriched = await provider.fetchDetails(
      provider.parseWebhook(validEventPayload),
    );
    expect(enriched.amount).toEqual('123');
    expect(enriched.currency).toEqual('usd');
  });

  // The currency arrives from the external source, not from the webhook
  // payload, so the hostile value has to come from the tx-detail client. Same
  // boundary rule as the Stripe provider: an unknown currency can never become
  // valid, so it must not be retried.
  it('rejects an unknown currency from the external source as non-retriable', async () => {
    jest.spyOn(txDetailClient, 'fetchMercadoPagoTxDetail').mockResolvedValue({
      id: '99999999',
      amount: 123,
      currency: 'xyz',
      status: 'success',
    });

    const raw = provider.parseWebhook(validEventPayload);

    await expect(provider.fetchDetails(raw)).rejects.toBeInstanceOf(
      UnsupportedCurrencyError,
    );
    await expect(provider.fetchDetails(raw)).rejects.toBeInstanceOf(
      NonRetriableError,
    );
  });
});
