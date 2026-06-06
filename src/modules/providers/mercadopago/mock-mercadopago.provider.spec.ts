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
  it('obtains full detail of a given transaction', async () => {
    const enriched = await provider.fetchDetails(
      provider.parseWebhook(validEventPayload),
    );
    expect(enriched.amount).toEqual('123');
    expect(enriched.currency).toEqual('usd');
  });
});
