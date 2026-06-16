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
import { Job, Queue } from 'bullmq';
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

    this.enqueueEvent(persistedEvent.event).catch((error) => {
      console.warn(
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

    await Promise.all(
      pendingEventsResult.elements.map((evt) =>
        this.enqueueEvent(evt).catch((error) => {
          console.error(
            new UnableToEnqueueEventError(evt.id, error as unknown as Error),
          );
        }),
      ),
    );
  }

  async processSingleEventById(id: string): Promise<void> {
    const eventToProcess = await this.webhookRepository.fetchEventById(id);
    if (!eventToProcess) {
      throw new EventNotFoundError(id);
    }
    await this.processSingleEvent(eventToProcess);
  }

  private async enqueueEvent(evt: WebhookEvent): Promise<Job> {
    return this.webhooksQueue.add(
      WEBHOOKS_PROCESSOR_JOB_NAME,
      { id: evt.id },
      {
        attempts: 1,
        jobId: `${WEBHOOKS_PROCESSOR_JOB_NAME}_${evt.id}`,
      },
    );
  }

  async processSingleEvent(singleEvent: WebhookEvent): Promise<void> {
    if (singleEvent.retries >= EVENT_MAX_PROCESSING_RETRIES) {
      await this.transitionToManualReview(
        singleEvent.id,
        PendingManualReviewReason.RETRIES_EXHAUSTED,
        { maxRetries: EVENT_MAX_PROCESSING_RETRIES },
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
      await this.transitionToManualReview(
        singleEvent.id,
        PendingManualReviewReason.UNSUPPORTED_CURRENCY,
        { currency: enrichedEventData.currency },
      );
      return;
    }

    const eventToTransaction = mapEventToTransaction(enrichedEventData.type);

    if (!eventToTransaction) {
      await this.transitionToManualReview(
        singleEvent.id,
        PendingManualReviewReason.UNSUPPORTED_EVENT_TYPE,
        { type: enrichedEventData.type, provider: providerInstance.name },
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

    console.log(
      `Event ${singleEvent.id} ended with status: ${processResult.status}`,
    );
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

  private async transitionToManualReview(
    id: string,
    reason: PendingManualReviewReason,
    context: Record<string, string | number>,
  ): Promise<void> {
    await this.webhookRepository.setEventForManualReview(id, reason);
    const messageToPrint = `Event ${id} ended with status: pending_manual_review. Reason: ${reason}. Trigger: ${JSON.stringify(context)}`;
    console.warn(messageToPrint);
  }
}
