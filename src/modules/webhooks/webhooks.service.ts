import { Injectable } from '@nestjs/common';
import { WebhookRepository } from './webhooks.repository';
import {
  PendingManualReviewReason,
  UnprocessedEvent,
  WebhookEvent,
} from './webhook.types';
import { ProvidersService } from '../providers/providers.service';
import { NewWebhookEvent } from './dto/new-webhook.dto';
import { UpsertTransactionData } from '../transactions/dto/create-transaction.dto';
import { isValidCurrency } from '@/shared/money/currency';
import { MAX_PROCESSING_RETRIES } from './webhook.constants';
import { mapEventToTransaction } from './mapper/event-transaction.mapper';

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

  async processPendingEvents(): Promise<void> {
    const pendingEventsResult =
      await this.webhookRepository.getPendingWebhookEvents();

    if (pendingEventsResult.status === 'none') {
      console.log(
        `There were no pending events found for processing - ${new Date().toISOString()}`,
      );

      return;
    }
    console.log(
      `There are ${pendingEventsResult.elements.length} events to process`,
    );

    await Promise.allSettled(
      pendingEventsResult.elements.map((evt) => this.processSingleEvent(evt)),
    );
  }

  async processSingleEvent(singleEvent: WebhookEvent): Promise<void> {
    if (singleEvent.retries >= MAX_PROCESSING_RETRIES) {
      await this.webhookRepository.setEventForManualReview(
        singleEvent.id,
        PendingManualReviewReason.RETRIES_EXHAUSTED,
      );
      return;
    }

    const rawProvider = await this.providerService.isValidProvider(
      singleEvent.providerId,
    );

    const providerInstance = this.providerService.getPaymentProviderInstance(
      rawProvider.name,
    );

    const enrichedEventData = await providerInstance.fetchDetails(
      providerInstance.parseWebhook(singleEvent.payload),
    );

    if (!isValidCurrency(enrichedEventData.currency)) {
      await this.webhookRepository.setEventForManualReview(
        singleEvent.id,
        PendingManualReviewReason.UNSUPPORTED_CURRENCY,
      );
      return;
    }

    const eventToTransaction = mapEventToTransaction(enrichedEventData.type);

    if (!eventToTransaction) {
      console.error(
        `Invalid event -> transaction map for value: ${enrichedEventData.type} with provider ${providerInstance.name}`,
      );

      await this.webhookRepository.setEventForManualReview(
        singleEvent.id,
        PendingManualReviewReason.UNSUPPORTED_EVENT_TYPE,
      );
      return;
    }

    const { status, type } = eventToTransaction;

    const rawTxData: UpsertTransactionData = {
      externalId: enrichedEventData.externalId,
      providerId: singleEvent.providerId,
      type,
      status,
      amount: enrichedEventData.amount,
      metadata: {},
      currency: enrichedEventData.currency,
    };

    const processResult = await this.webhookRepository.markEventAsProcessed(
      enrichedEventData,
      rawTxData,
    );

    console.log(`${singleEvent.id} ended with status: ${processResult.status}`);
  }

  async findUnprocessedEvents(): Promise<UnprocessedEvent[]> {
    const events = await this.webhookRepository.findUnprocessedEvents();

    const now = Date.now();

    return events.map((evt) => {
      const ageInDays = Math.floor(
        (now - evt.receivedAt.getTime()) / (1000 * 60 * 60 * 24),
      );

      return {
        ...evt,
        receivedAt: evt.receivedAt.toISOString(),
        ageInDays,
      };
    });
  }
}
