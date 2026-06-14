import { Processor, WorkerHost } from '@nestjs/bullmq';
import { WEBHOOKS_QUEUE_NAME } from './webhook.constants';
import { Job } from 'bullmq';
import { WebhookService } from './webhooks.service';

@Processor(WEBHOOKS_QUEUE_NAME)
export class WebhooksConsumer extends WorkerHost {
  constructor(private webhookService: WebhookService) {
    super();
  }

  async process(job: Job<{ id: string }>): Promise<void> {
    return this.webhookService.processSingleEventById(job.data.id);
  }
}
