import { Currencies } from '@/shared/money/currency';

export type ProviderEventType =
  | 'payment.succeeded'
  | 'payment.failed'
  | 'payment.refunded';

export type RawProviderEvent = {
  externalEventId: string;
  externalId: string;
  rawEventData: Record<string, unknown>;
};

// `currency` is `Currencies`, not `string`: enrichment is the anti-corruption
// boundary and it rejects anything else with `UnsupportedCurrencyError`. The
// type states that guarantee, so downstream code cannot be written as if an
// unknown currency could still arrive. This narrowing used to be produced by a
// guard in the service that was unreachable at runtime.
export type EnrichedProviderEvent = RawProviderEvent & {
  amount: string;
  currency: Currencies;
  type: ProviderEventType;
};
