import { Injectable } from '@nestjs/common';
import { ProvidersRepository } from './providers.repository';
import { Provider } from './provider.type';
import { PaymentProviderFactory } from './providers.factory';
import { RawProviderEvent } from './provider-event.type';

@Injectable()
export class ProvidersService {
  constructor(private providersRepository: ProvidersRepository) {}

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
}
