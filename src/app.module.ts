import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './shared/database/database.module';
import { TransactionsModule } from './modules/transactions/transactions.module';
import { ProvidersModule } from './modules/providers/providers.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { ReconciliationModule } from './modules/reconciliation/reconciliation.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // NestJS busca `.env` por default; nosotros usamos archivos por entorno.
      envFilePath: `.env.${process.env.NODE_ENV ?? 'development'}`,
    }),
    DatabaseModule,
    TransactionsModule,
    ProvidersModule,
    WebhooksModule,
    ReconciliationModule,
    HealthModule,
  ],
})
export class AppModule {}
