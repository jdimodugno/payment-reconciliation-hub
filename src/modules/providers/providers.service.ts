import { Injectable } from '@nestjs/common';
import { ProvidersRepository } from './providers.repository';
import { Provider } from './provider.type';
import { PaymentProviderFactory } from './providers.factory';
import { RawProviderEvent } from './provider-event.type';
import { PaymentProvider } from './payment-provider.interface';

@Injectable()
export class ProvidersService {
  _paymentProvidersFactory: PaymentProviderFactory;

  constructor(private providersRepository: ProvidersRepository) {
    this._paymentProvidersFactory = new PaymentProviderFactory();
  }

  async isValidProvider(providerId: string): Promise<Provider> {
    return this.providersRepository.existsAndIsEnabled(providerId);
  }

  async tryParsingRawProviderEvent(
    providerId: string,
    rawProviderEvent: unknown,
  ): Promise<RawProviderEvent> {
    const provider = await this.isValidProvider(providerId);
    const providerInstance = PaymentProviderFactory.fromName(provider.name);
    const providerEvent = providerInstance.parseWebhook(rawProviderEvent);
    return providerEvent;
  }

  getPaymentProviderInstance(providerName: string): PaymentProvider {
    return this._paymentProvidersFactory.getProviderInstance(providerName);
  }
}
