import { Module } from '@nestjs/common';
import { WebhookController } from './webhooks.controller';
import { WebhookService } from './webhooks.service';
import { WebhookRepository } from './webhooks.repository';
import { ProvidersModule } from '../providers/providers.module';
import { BullModule } from '@nestjs/bullmq';
import { WEBHOOKS_QUEUE_NAME } from './webhook.constants';
import { WebhooksConsumer } from './webhooks.consumer';
import { DeadLetterRepository } from './dead-letter.repository';

/**
 * WebhooksModule
 *
 * Receives webhook events from payment providers and queues them for
 * async processing.
 *
 * Critical concepts (semana 2-3):
 * - IDEMPOTENCY (see PRINCIPLE T5 + ADR-004 when written)
 *   Same event received multiple times must produce same result.
 * - SIGNATURE VERIFICATION (HMAC per provider)
 * - RAW STORAGE before processing (audit trail)
 * - RETRY POLICY with exponential backoff (see ADR-005 when written)
 * - DEAD LETTER QUEUE for events that keep failing
 *
 * To implement:
 * - WebhookEvent entity (with externalEventId UNIQUE constraint)
 * - WebhookReceiverController (one endpoint per provider)
 * - WebhookProcessor (BullMQ consumer)
 * - SignatureVerifierService
 */
@Module({
  imports: [
    ProvidersModule,
    BullModule.registerQueue({
      name: WEBHOOKS_QUEUE_NAME,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
      },
    }),
  ],
  controllers: [WebhookController],
  providers: [
    WebhookService,
    WebhookRepository,
    WebhooksConsumer,
    DeadLetterRepository,
  ],
})
export class WebhooksModule {}
