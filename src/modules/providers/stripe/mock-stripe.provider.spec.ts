import { Money } from '@/shared/money/money';
import { MockStripeProvider } from './mock-stripe.provider';

describe('MockStripeProvider.parseWebhook', () => {
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

  it('parses a valid payload into a ProviderEvent', () => {
    const event = provider.parseWebhook(validPayload);

    expect(event.externalId).toEqual('pi_456');
    expect(event.externalEventId).toEqual('evt_123');
    expect(event.amount).toEqual('20');
    expect(event.type).toEqual('payment.succeeded');
    expect(event.currency).toEqual('usd');
  });

  it('converts minor units to decimal correctly', () => {
    const eventAmount = Money.fromMinorUnits(
      validPayload.data.object.amount,
      validPayload.data.object.currency,
    ).toDecimal();
    expect(eventAmount).toEqual('20');
  });

  it('throws on a malformed payload', () => {
    expect(() => provider.parseWebhook({ foo: 'bar' })).toThrow();
  });

  it('throws on an unknown event type', () => {
    expect(() =>
      provider.parseWebhook({
        ...validPayload,
        data: { ...validPayload.data },
        type: 'charge.disputed',
      }),
    ).toThrow();
  });
});
