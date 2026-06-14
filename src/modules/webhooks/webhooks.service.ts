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
import {
  EVENT_MAX_PROCESSING_RETRIES,
  WEBHOOKS_PROCESSOR_JOB_NAME,
} from './webhook.constants';
import { mapEventToTransaction } from './mapper/event-transaction.mapper';
import { InjectQueue } from '@nestjs/bullmq';
import { WEBHOOKS_QUEUE_NAME } from './webhook.constants';
import { Queue } from 'bullmq';
import {
  EventNotFoundError,
  UnableToEnqueueEventError,
} from './webhook.exception';

@Injectable()
export class WebhookService {
  constructor(
    private providerService: ProvidersService,
    private webhookRepository: WebhookRepository,
    @InjectQueue(WEBHOOKS_QUEUE_NAME) private webhooksQueue: Queue,
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

    this.webhooksQueue
      .add(
        WEBHOOKS_PROCESSOR_JOB_NAME,
        { id: persistedEvent.event.id },
        {
          attempts: 1,
          jobId: `${WEBHOOKS_PROCESSOR_JOB_NAME}_${persistedEvent.event.id}`,
        },
      )
      .catch((error) => {
        console.error(
          new UnableToEnqueueEventError(
            persistedEvent.event.id,
            error as unknown as Error,
          ),
        );
      });

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

  async processSingleEventById(id: string): Promise<void> {
    const eventToProcess = await this.webhookRepository.fetchEventById(id);
    if (!eventToProcess) {
      throw new EventNotFoundError(id);
    }
    await this.processSingleEvent(eventToProcess);
  }

  async processSingleEvent(singleEvent: WebhookEvent): Promise<void> {
    if (singleEvent.retries >= EVENT_MAX_PROCESSING_RETRIES) {
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
