import { Processor, WorkerHost } from '@nestjs/bullmq';
import { WEBHOOKS_QUEUE_NAME } from './webhook.constants';
import { Job, UnrecoverableError } from 'bullmq';
import { WebhookService } from './webhooks.service';
import { NonRetriableError } from '@/shared/exception/non-retriable.exception';

@Processor(WEBHOOKS_QUEUE_NAME)
export class WebhooksConsumer extends WorkerHost {
  constructor(private webhookService: WebhookService) {
    super();
  }

  async process(job: Job<{ id: string }>): Promise<void> {
    return this.webhookService
      .processSingleEventById(job.data.id)
      .catch((error) => {
        if (error instanceof NonRetriableError) {
          throw new UnrecoverableError(error.message);
        }
        throw error;
      });
  }
}
