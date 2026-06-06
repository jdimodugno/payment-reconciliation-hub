import { BadRequestException } from '@nestjs/common';
import { MockMercadoPagoProvider } from './mercadopago/mock-mercadopago.provider';
import { PaymentProvider } from './payment-provider.interface';
import { MockStripeProvider } from './stripe/mock-stripe.provider';

type PaymentProviderConstructor = new () => PaymentProvider;

type ProviderType = 'mercadopago' | 'stripe';

const providers: Record<ProviderType, PaymentProviderConstructor> = {
  mercadopago: MockMercadoPagoProvider,
  stripe: MockStripeProvider,
};

export function createProvider(name: ProviderType): PaymentProvider {
  return new providers[name]();
}

export const isValidProvider = (
  providerName: string,
): providerName is ProviderType => {
  return providerName in providers;
};

export class PaymentProviderFactory {
  static fromName(providerName: string): PaymentProvider {
    if (!isValidProvider(providerName)) {
      throw new BadRequestException(`Invalid provider - ${providerName}`);
    }
    return createProvider(providerName);
  }
}
