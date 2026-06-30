import { Injectable } from '@nestjs/common';
import { WebhookRepository } from './webhooks.repository';
import {
  PendingManualReviewReason,
  ReconciliationStatus,
  WebhookEvent,
} from './webhook.types';
import { ProvidersService } from '../providers/providers.service';
import { NewWebhookEvent } from './dto/new-webhook.dto';
import { UpsertTransactionData } from '../transactions/dto/create-transaction.dto';
import { isValidCurrency } from '@/shared/money/currency';
import { WEBHOOKS_PROCESSOR_JOB_NAME } from './webhook.constants';
import { mapEventToTransaction } from './mapper/event-transaction.mapper';
import { InjectQueue } from '@nestjs/bullmq';
import { WEBHOOKS_QUEUE_NAME } from './webhook.constants';
import { Job, Queue } from 'bullmq';
import {
  EventNotFoundError,
  UnableToEnqueueEventError,
} from './webhook.exception';
import { DeadLetterRepository } from './dead-letter.repository';
import {
  DeadLetterEventData,
  deadLetterEventSerializer,
} from './dead-letter.types';
import { StructuredLogger } from '@/shared/logging/logger';
@Injectable()
export class WebhookService {
  constructor(
    private providerService: ProvidersService,
    private webhookRepository: WebhookRepository,
    private deadLetterRepository: DeadLetterRepository,
    private logger: StructuredLogger,
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
        jobId: `${WEBHOOKS_PROCESSOR_JOB_NAME}_${evt.id}`,
      },
    );
  }

  async processSingleEvent(singleEvent: WebhookEvent): Promise<void> {
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

  async getReconciliationStatus(): Promise<ReconciliationStatus> {
    const events = await this.webhookRepository.findUnprocessedEvents();
    const countByStatus =
      await this.webhookRepository.getEventsInTerminalStatusCountByGroup();

    const deadLetteredEvents =
      await this.deadLetterRepository.getDistinctEventIdCount();

    const now = Date.now();

    if (deadLetteredEvents === null || countByStatus === null) {
      return {
        error: 'An error occurred while obtaining reconciliation status',
      };
    }

    return {
      deadLetteredEvents,
      eventsByStatus: countByStatus,
      unprocessedEvents: events.map((evt) => {
        const ageInDays = Math.floor(
          (now - evt.receivedAt.getTime()) / (1000 * 60 * 60 * 24),
        );

        return {
          ...evt,
          receivedAt: evt.receivedAt.toISOString(),
          ageInDays,
        };
      }),
      total: countByStatus.pendingManualReview + countByStatus.processed,
    };
  }

  private async transitionToManualReview(
    id: string,
    reason: PendingManualReviewReason,
    context: Record<string, string | number>,
  ): Promise<void> {
    const deadLetterData: DeadLetterEventData = {
      eventId: id,
      reason,
      lastError: JSON.stringify(context),
    };
    this.logger.warn(
      deadLetterData,
      deadLetterEventSerializer,
      'about to transition event to manual review',
    );
    await this.deadLetterRepository.append(deadLetterData);
    await this.webhookRepository.setEventForManualReview(id);
    this.logger.warn(
      deadLetterData,
      deadLetterEventSerializer,
      'event transitioned to manual review',
    );
  }
}
