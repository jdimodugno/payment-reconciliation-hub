import { MockStripeProvider } from './mock-stripe.provider';

const provider = new MockStripeProvider();

const validPayload = {
  id: 'evt_123',
  object: 'event',
  type: 'payment_intent.succeeded',
  data: {
    object: {
      id: 'pi_456',
      amount: 2000,
      currency: 'usd',
      status: 'succeeded',
    },
  },
};

describe('MockStripeProvider.parseWebhook', () => {
  it('parses a valid payload into a ProviderEvent', () => {
    const event = provider.parseWebhook(validPayload);

    expect(event.externalId).toEqual('pi_456');
    expect(event.externalEventId).toEqual('evt_123');
  });

  it('throws on a malformed payload', () => {
    expect(() => provider.parseWebhook({ foo: 'bar' })).toThrow();
  });

  it('tolerates an unknown event type at parse, rejects it at enrichment', async () => {
    const unknownTypeEvent = { ...validPayload, type: 'charge.disputed' };
    const raw = provider.parseWebhook(unknownTypeEvent);
    expect(raw.externalEventId).toEqual('evt_123');
    expect(raw.externalId).toEqual('pi_456');
    await expect(provider.fetchDetails(raw)).rejects.toThrow();
  });
});

describe('MockStripeProvider.fetchDetails', () => {
  it('obtains full detail of a given transaction', async () => {
    const enriched = await provider.fetchDetails(
      provider.parseWebhook(validPayload),
    );
    expect(enriched.amount).toEqual('20');
    expect(enriched.currency).toEqual('usd');
  });
});
