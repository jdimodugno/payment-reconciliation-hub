import { BadRequestException } from '@nestjs/common';
import { MockMercadoPagoProvider } from './mercadopago/mock-mercadopago.provider';
import { PaymentProvider } from './payment-provider.interface';
import { MockStripeProvider } from './stripe/mock-stripe.provider';

type PaymentProviderConstructor = new () => PaymentProvider;

export type ProviderType = 'mercadopago' | 'stripe';

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
  return Object.hasOwn(providers, providerName);
};

export class PaymentProviderFactory {
  _instances: Record<ProviderType, PaymentProvider | null>;

  constructor() {
    this._instances = {
      mercadopago: null,
      stripe: null,
    };
  }

  static fromName(providerName: string): PaymentProvider {
    if (!isValidProvider(providerName)) {
      throw new BadRequestException(`Invalid provider - ${providerName}`);
    }
    return createProvider(providerName);
  }

  getProviderInstance(providerName: string): PaymentProvider {
    if (!isValidProvider(providerName)) {
      throw new BadRequestException(`Invalid provider - ${providerName}`);
    }
    if (!this._instances[providerName])
      this._instances[providerName] = createProvider(providerName);
    return this._instances[providerName];
  }
}
