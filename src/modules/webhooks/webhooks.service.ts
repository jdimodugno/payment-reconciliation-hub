import { Injectable } from '@nestjs/common';
import { WebhookRepository } from './webhooks.repository';
import { WebhookEvent } from './webhook.types';
import { ProvidersService } from '../providers/providers.service';
import { NewWebhookEvent } from './dto/new-webhook.dto';

@Injectable()
export class WebhookService {
  constructor(
    private providerService: ProvidersService,
    private webhookRepository: WebhookRepository,
  ) {}

  async createWebhookNotification(
    providerId: string,
    rawEvent: unknown,
  ): Promise<{ status: 'created' | 'existed'; event: WebhookEvent }> {
    const eventData = await this.providerService.tryParsingRawProviderEvent(
      providerId,
      rawEvent,
    );

    const notification: NewWebhookEvent = {
      externalEventId: eventData.externalEventId,
      providerId: providerId,
      status: 'received',
      payload: eventData.rawEventData,
    };

    const persistedEvent = await this.webhookRepository.create(notification);

    // enqueue

    return persistedEvent;
  }
}
