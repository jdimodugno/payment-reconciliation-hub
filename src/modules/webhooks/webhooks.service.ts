import { Injectable } from '@nestjs/common';
import { WebhookRepository } from './webhooks.repository';
import {
  PendingManualReviewReason,
  ProviderSideEvent,
  ProviderSideEventsResult,
  ReconciliationStatus,
  WebhookEvent,
  WebhookEventSerializer,
} from './webhook.types';
import { ProvidersService } from '../providers/providers.service';
import { EnrichedProviderEvent } from '../providers/provider-event.type';
import { NewWebhookEvent } from './dto/new-webhook.dto';
import { UpsertTransactionData } from '../transactions/dto/create-transaction.dto';
import { WEBHOOKS_PROCESSOR_JOB_NAME } from './webhook.constants';
import { mapEventToTransaction } from './mapper/event-transaction.mapper';
import { InjectQueue } from '@nestjs/bullmq';
import { WEBHOOKS_QUEUE_NAME } from './webhook.constants';
import { Job, Queue } from 'bullmq';
import {
  EventNotFoundError,
  EventNotReprocessableError,
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
      this.logger.warn(
        persistedEvent.event,
        WebhookEventSerializer,
        'Unable to enqueue for processing',
        error,
      );
    });

    return persistedEvent;
  }

  async processPendingEvents(): Promise<void> {
    const pendingEventsResult =
      await this.webhookRepository.getPendingWebhookEvents();

    if (pendingEventsResult.status === 'none') {
      return;
    }

    await Promise.all(
      pendingEventsResult.elements.map((evt) =>
        this.enqueueEvent(evt).catch((error) => {
          this.logger.warn(
            evt,
            WebhookEventSerializer,
            'Unable to enqueue for processing',
            error,
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

  // ADR-015: reinyección manual de un evento dead-lettered. Flip transitorio
  // pending_manual_review → received (árbitro atómico en el repo), luego reusa la
  // maquinaria de procesamiento vía enqueueEvent con un jobId por-intento.
  // El camino de re-muerte NO necesita código nuevo: si vuelve a fallar,
  // processSingleEvent → transitionToManualReview appendea al anexo y vuelve a
  // pending_manual_review.
  async reprocess(eventId: string): Promise<void> {
    const event = await this.webhookRepository.fetchEventById(eventId);
    if (!event) {
      throw new EventNotFoundError(eventId);
    }

    // La generación viene del propio flip: es el `retries` ya incrementado. Antes
    // se derivaba contando filas del anexo, un número que dejó de significar
    // "veces que murió" en cuanto los reintentos de la transición empezaron a
    // dejar rastro. El flip es la definición misma de una muerte nueva.
    const generation =
      await this.webhookRepository.reactivateForReprocess(eventId);
    if (generation === null) {
      throw new EventNotReprocessableError(eventId, event.status);
    }

    await this.enqueueEvent(
      event,
      `${WEBHOOKS_PROCESSOR_JOB_NAME}_${eventId}_retry_${generation}`,
    );
  }

  private async enqueueEvent(evt: WebhookEvent, jobId?: string): Promise<Job> {
    return this.webhooksQueue.add(
      WEBHOOKS_PROCESSOR_JOB_NAME,
      { id: evt.id },
      {
        jobId: jobId ?? `${WEBHOOKS_PROCESSOR_JOB_NAME}_${evt.id}`,
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

    // The unsupported-currency guard used to live here and was unreachable:
    // `fetchDetails` builds a Money, which rejects an unknown currency and
    // throws before this line. Only a mocked provider could produce the state
    // this guard checked for. The provider now raises
    // `UnsupportedCurrencyError` (non-retriable) at the boundary instead.
    const eventToTransaction = mapEventToTransaction(enrichedEventData.type);

    if (!eventToTransaction) {
      await this.transitionToManualReview(
        singleEvent,
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

    let messageToLog: string;

    switch (processResult.status) {
      case 'failed':
        messageToLog = 'Event processing failed';
        break;
      case 'already_processed':
        messageToLog = 'Event was already processed';
        break;
      case 'processed':
        messageToLog = 'Event was processed';
        break;
    }

    this.logger.info(singleEvent, WebhookEventSerializer, messageToLog);
  }

  /**
   * Lado provider para la reconciliación, re-derivado al vuelo (ADR-014: auditar,
   * no confiar). Re-corre la MISMA cadena que creó las Transaction —
   * `parseWebhook` → `fetchDetails` → `mapEventToTransaction`— sobre lo que el
   * provider dijo, sin leer nada del lado interno.
   *
   * Devuelve una forma PROPIA, no `ProviderSide`: si este módulo importara los
   * tipos de `reconciliation/`, la flecha apuntaría para los dos lados y se caería
   * la razón por la que el shell vive allá (ADR-017 D1). Acá se contesta "qué dijo
   * el provider"; traducir eso a la forma que el matcher compara es del shell.
   *
   * Un evento que no se puede enriquecer NO frena la corrida, pero tampoco se
   * desaparece: se cuenta en `unreadable`. Un evento malformado no es hipotético
   * —es lo que vive en `pending_manual_review`— así que tirar acá dejaría la
   * reconciliación bloqueada para siempre por un evento roto de hace tres meses.
   * Y saltearlo en silencio sería peor: el par quedaría sin lado provider y el
   * matcher lo reportaría como `missing_provider`, que es FALSO —el provider sí
   * lo reportó, nosotros no pudimos leerlo—. El contador mantiene la distinción
   * que vale: "no pude leer" no es "leí 0".
   */
  async findProviderSideEvents(): Promise<ProviderSideEventsResult> {
    const events = await this.webhookRepository.findAllEvents();

    const readable: ProviderSideEvent[] = [];
    let unreadable = 0;

    for (const event of events) {
      const rawProvider = await this.providerService.isValidProvider(
        event.providerId,
      );
      const providerInstance = this.providerService.getPaymentProviderInstance(
        rawProvider.name,
      );

      let enriched: EnrichedProviderEvent;
      try {
        enriched = await providerInstance.fetchDetails(
          providerInstance.parseWebhook(event.payload),
        );
      } catch {
        // Deliberadamente ancho: cualquier motivo por el que este evento no se
        // deja leer cuenta igual. Lo que NO se hace es tratarlo como ausencia.
        unreadable += 1;
        this.logger.warn(
          event,
          WebhookEventSerializer,
          'event could not be enriched for reconciliation; counted as unreadable',
        );
        continue;
      }

      // `mapEventToTransaction` no puede devolver null acá: `fetchDetails` ya
      // rechazó todo tipo que el dominio no modele, así que un enriched.type
      // siempre mapea. Sin guarda muerta: una rama inalcanzable se lee como caso
      // cubierto (misma razón por la que se borró UNSUPPORTED_CURRENCY en d29).
      const { status } = mapEventToTransaction(enriched.type)!;

      readable.push({
        providerId: event.providerId,
        providerRef: enriched.externalId,
        amount: enriched.amount,
        currency: enriched.currency,
        status,
        rawStatus: enriched.type,
      });
    }

    return { events: readable, unreadable };
  }

  async getReconciliationStatus(): Promise<ReconciliationStatus> {
    const events = await this.webhookRepository.findUnprocessedEvents();
    const countByStatus =
      await this.webhookRepository.getEventsInTerminalStatusCountByGroup();

    const deadLetteredEvents =
      await this.deadLetterRepository.getDistinctEventIdCount();

    const now = Date.now();

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

  // Recibe el evento entero, no sólo el id, porque la generación de esta muerte
  // es su `retries` actual. El valor es estable durante todo el procesamiento:
  // lo único que lo mueve es `reactivateForReprocess`, que exige
  // `status = 'pending_manual_review'` — imposible mientras el evento está siendo
  // procesado. Por eso alcanza con el que ya trae el job, sin releer la fila.
  private async transitionToManualReview(
    event: WebhookEvent,
    reason: PendingManualReviewReason,
    context: Record<string, string | number>,
  ): Promise<void> {
    const deadLetterData: DeadLetterEventData = {
      eventId: event.id,
      generation: event.retries,
      reason,
      lastError: JSON.stringify(context),
    };
    this.logger.warn(
      deadLetterData,
      deadLetterEventSerializer,
      'about to transition event to manual review',
    );
    await this.deadLetterRepository.append(deadLetterData);
    await this.webhookRepository.setEventForManualReview(event.id);
    this.logger.warn(
      deadLetterData,
      deadLetterEventSerializer,
      'event transitioned to manual review',
    );
  }
}
