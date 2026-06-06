import { Module } from '@nestjs/common';
import { ProvidersService } from './providers.service';
import { ProvidersRepository } from './providers.repository';

/**
 * ProvidersModule
 *
 * Abstracts payment providers (Stripe, MercadoPago, etc.) behind a common
 * interface. Each provider implements PaymentProvider with its own
 * webhook parsing, transaction fetching, and authentication.
 *
 * To implement (semana 1):
 * - PaymentProvider interface
 * - MockStripeProvider (reference implementation)
 * - MockMercadoPagoProvider
 * - ProviderRegistry (DI of providers by name)
 *
 * Design principle: providers are PLUGINS. Adding a new one should not
 * require changes outside this module.
 */
@Module({
  providers: [ProvidersService, ProvidersRepository],
  exports: [ProvidersService],
})
export class ProvidersModule {}
