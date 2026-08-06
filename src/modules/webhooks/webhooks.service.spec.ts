import { Test } from '@nestjs/testing';
import { WebhookService } from './webhooks.service';
import { WebhookRepository } from './webhooks.repository';
import { ProvidersService } from '../providers/providers.service';
import {
  PendingManualReviewReason,
  SuccessfulReconciliationStatus,
  WebhookEvent,
} from './webhook.types';
import z from 'zod';
import {
  WEBHOOKS_PROCESSOR_JOB_NAME,
  WEBHOOKS_QUEUE_NAME,
} from './webhook.constants';
import { getQueueToken } from '@nestjs/bullmq';
import {
  EventNotFoundError,
  EventNotReprocessableError,
} from './webhook.exception';
import { DeadLetterRepository } from './dead-letter.repository';
import { StructuredLogger } from '@/shared/logging/logger';

const logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

const webhookRepository = {
  setEventForManualReview: jest.fn(),
  markEventAsProcessed: jest.fn(),
  getPendingWebhookEvents: jest.fn(),
  findUnprocessedEvents: jest.fn(),
  fetchEventById: jest.fn(),
  create: jest.fn(),
  getEventsInTerminalStatusCountByGroup: jest.fn(),
  reactivateForReprocess: jest.fn(),
};

const deadLetterRepository = {
  append: jest.fn(),
  getDistinctEventIdCount: jest.fn(),
};

const providerInstance = {
  name: 'MOCK_STRIPE',
  parseWebhook: jest.fn(),
  fetchDetails: jest.fn(),
};

const providersService = {
  isValidProvider: jest.fn().mockResolvedValue({ name: 'stripe' }),
  getPaymentProviderInstance: jest.fn().mockReturnValue(providerInstance),
  tryParsingRawProviderEvent: jest.fn(),
};

const webhooksQueue = {
  add: jest.fn().mockResolvedValue({}),
};

let service: WebhookService;

const buildEvent = (overrides: Partial<WebhookEvent> = {}): WebhookEvent =>
  ({
    id: 'evt-uuid',
    providerId: 'prov-uuid',
    externalEventId: 'ext-1',
    status: 'received',
    retries: 0,
    payload: {},
    receivedAt: new Date().toISOString(),
    processedAt: null,
    transactionId: null,
    ...overrides,
  }) as WebhookEvent;

describe('WebhookService', () => {
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: StructuredLogger, useValue: logger },
        WebhookService,
        { provide: WebhookRepository, useValue: webhookRepository },
        { provide: DeadLetterRepository, useValue: deadLetterRepository },
        { provide: ProvidersService, useValue: providersService },
        {
          provide: getQueueToken(WEBHOOKS_QUEUE_NAME),
          useValue: webhooksQueue,
        },
      ],
    }).compile();
    service = moduleRef.get(WebhookService);
  });
  describe('WebhookService.processSingleEvent', () => {
    beforeEach(async () => {
      jest.clearAllMocks();
    });

    // The unsupported-currency guard is gone: it sat after `fetchDetails`,
    // which builds a Money and rejects an unknown currency before that line was
    // ever reached. Only a mocked provider could produce the state it checked
    // for. The providers now raise `UnsupportedCurrencyError` (non-retriable) at
    // the anti-corruption boundary, covered in their own specs.

    describe('guard: event-type no mapeable', () => {
      it('mapping null → setEventForManualReview(UNSUPPORTED_EVENT_TYPE) y NO procesa', async () => {
        const event = buildEvent();
        providerInstance.fetchDetails.mockResolvedValue({
          currency: 'usd',
          type: 'payment.disputed',
          ...event,
        });
        await service.processSingleEvent(event);
        expect(webhookRepository.markEventAsProcessed).not.toHaveBeenCalled();
        expect(deadLetterRepository.append).toHaveBeenCalledWith({
          eventId: event.id,
          // La muerte congela la generación en la que ocurrió: el `retries` del
          // evento al morir. Un evento recién recibido muere en la generación 0.
          generation: event.retries,
          reason: PendingManualReviewReason.UNSUPPORTED_EVENT_TYPE,
          lastError: expect.any(String),
        });
        expect(webhookRepository.setEventForManualReview).toHaveBeenCalledWith(
          event.id,
        );
        expect(
          deadLetterRepository.append.mock.invocationCallOrder[0],
        ).toBeLessThan(
          webhookRepository.setEventForManualReview.mock.invocationCallOrder[0],
        );
      });

      // T5: the annex write is the audit evidence. If it fails, the transition
      // MUST NOT continue — an event sitting in `pending_manual_review` with no
      // annex row is unreconstructable. The error propagates so BullMQ retries.
      it('append al anexo falla → NO flipea a manual review y propaga el error', async () => {
        const event = buildEvent();
        providerInstance.fetchDetails.mockResolvedValue({
          currency: 'usd',
          type: 'payment.disputed',
          ...event,
        });
        const writeFailure = new Error('annex write failed');
        deadLetterRepository.append.mockRejectedValueOnce(writeFailure);

        await expect(service.processSingleEvent(event)).rejects.toBe(
          writeFailure,
        );

        expect(
          webhookRepository.setEventForManualReview,
        ).not.toHaveBeenCalled();
      });
    });

    describe('happy path', () => {
      it('evento válido → llama markEventAsProcessed con type/status mapeados (no hardcodeados)', async () => {
        const event = buildEvent();
        const enriched = {
          currency: 'usd',
          type: 'payment.succeeded',
          amount: '2000',
          externalId: 'pi_1',
          externalEventId: 'evt_1',
          rawEventData: {},
        };
        providerInstance.fetchDetails.mockResolvedValue(enriched);
        webhookRepository.markEventAsProcessed.mockResolvedValue({
          status: 'processed',
        });
        await service.processSingleEvent(event);
        expect(webhookRepository.markEventAsProcessed).toHaveBeenCalledWith(
          enriched,
          expect.objectContaining({ type: 'payin', status: 'settled' }),
        );
      });
    });
  });

  describe('WebhookService.getReconciliationStatus', () => {
    const NOW = new Date('2026-06-11T00:00:00.000Z').getTime();
    const DAY_MS = 1000 * 60 * 60 * 24;

    const rowReceivedDaysAgo = (id: string, daysAgo: number) => ({
      id,
      receivedAt: new Date(NOW - daysAgo * DAY_MS),
    });

    beforeAll(() => {
      jest.spyOn(Date, 'now').mockReturnValue(NOW);
    });

    afterAll(() => {
      jest.restoreAllMocks();
    });

    beforeEach(async () => {
      jest.clearAllMocks();
    });

    it('deriva ageInDays correcto, receivedAt como ISO string, total como suma de subgrupos', async () => {
      webhookRepository.findUnprocessedEvents.mockResolvedValue([
        rowReceivedDaysAgo('evt-10d', 10),
        rowReceivedDaysAgo('evt-3d', 3),
        rowReceivedDaysAgo('evt-0d', 0),
      ]);

      webhookRepository.getEventsInTerminalStatusCountByGroup.mockResolvedValue(
        { processed: 1, pendingManualReview: 2 },
      );

      deadLetterRepository.getDistinctEventIdCount.mockResolvedValue(1);

      const rawResult = await service.getReconciliationStatus();

      if (Object.hasOwn(rawResult, 'error')) throw new Error('expected error');

      const castedResult = rawResult as SuccessfulReconciliationStatus;

      const events = castedResult.unprocessedEvents;

      expect(events[0].ageInDays).toBe(10);
      expect(z.iso.datetime().safeParse(events[0].receivedAt).success).toBe(
        true,
      );
      expect(events[1].ageInDays).toBe(3);
      expect(z.iso.datetime().safeParse(events[1].receivedAt).success).toBe(
        true,
      );
      expect(events[2].ageInDays).toBe(0);
      expect(z.iso.datetime().safeParse(events[2].receivedAt).success).toBe(
        true,
      );

      expect(castedResult.eventsByStatus.processed).not.toBeUndefined();
      expect(
        castedResult.eventsByStatus.pendingManualReview,
      ).not.toBeUndefined();
      expect(castedResult.eventsByStatus.pendingManualReview).toBe(2);
      expect(castedResult.eventsByStatus.processed).toBe(1);
      expect(castedResult.deadLetteredEvents).toBe(1);
      expect(castedResult.total).toBe(3);
    });

    it('repo vacío → []', async () => {
      webhookRepository.findUnprocessedEvents.mockResolvedValue([]);
      const rawResult = await service.getReconciliationStatus();
      if (Object.hasOwn(rawResult, 'error'))
        throw new Error('unexpected error');
      const castedResult = rawResult as SuccessfulReconciliationStatus;

      expect(castedResult.unprocessedEvents.length).toBe(0);
    });

    // A failed read is unexpected infrastructure failure, not a domain outcome:
    // it propagates with its cause so the HTTP boundary answers 500. These
    // replace the previous pair, which asserted a degraded `{ error }` body
    // returned with a 200 — a response monitoring counts as success.
    it('falla la lectura de los counts por estado → propaga, no devuelve status degradado', async () => {
      const readFailure = new Error('connection terminated');
      webhookRepository.getEventsInTerminalStatusCountByGroup.mockRejectedValue(
        readFailure,
      );

      await expect(service.getReconciliationStatus()).rejects.toBe(readFailure);
    });

    it('falla la lectura de dead-lettered → propaga, no devuelve status degradado', async () => {
      webhookRepository.getEventsInTerminalStatusCountByGroup.mockResolvedValue(
        {
          processed: 1,
          pendingManualReview: 2,
        },
      );
      const readFailure = new Error('connection terminated');
      deadLetterRepository.getDistinctEventIdCount.mockRejectedValue(
        readFailure,
      );

      await expect(service.getReconciliationStatus()).rejects.toBe(readFailure);
    });
  });

  describe('WebhookService.processSingleEventById', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    afterEach(() => {
      jest.restoreAllMocks(); // restaura el spyOn(processSingleEvent) para no filtrar
    });

    it('id inexistente → fetchEventById null → lanza EventNotFoundError y NO procesa', async () => {
      webhookRepository.fetchEventById.mockResolvedValue(null);

      await expect(service.processSingleEventById('missing')).rejects.toThrow(
        EventNotFoundError,
      );
      expect(webhookRepository.markEventAsProcessed).not.toHaveBeenCalled();
    });

    it('id existente → fetchea y delega a processSingleEvent con el evento', async () => {
      const event = buildEvent({ id: 'evt-found' });
      webhookRepository.fetchEventById.mockResolvedValue(event);
      const processSpy = jest
        .spyOn(service, 'processSingleEvent')
        .mockResolvedValue(undefined);

      await service.processSingleEventById(event.id);
      expect(processSpy).toHaveBeenCalledWith(event);
      expect(processSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('WebhookService.createWebhookNotification (enqueue)', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('tras persistir, encola por id con jobId compuesto', async () => {
      providersService.tryParsingRawProviderEvent.mockResolvedValue({
        externalEventId: 'ext-1',
        rawEventData: {},
      });
      webhookRepository.create.mockResolvedValue({
        status: 'created',
        event: buildEvent({ id: 'evt-enqueue' }),
      });

      await service.createWebhookNotification('prov-uuid', {});

      expect(webhooksQueue.add).toHaveBeenCalledWith(
        WEBHOOKS_PROCESSOR_JOB_NAME,
        { id: 'evt-enqueue' },
        {
          jobId: `${WEBHOOKS_PROCESSOR_JOB_NAME}_evt-enqueue`,
        },
      );
    });
  });

  describe('WebhookService.processPendingEvents (recovery sweep)', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      webhooksQueue.add.mockResolvedValue({});
    });

    it('sin eventos pendientes (status "none") → no encola nada', async () => {
      webhookRepository.getPendingWebhookEvents.mockResolvedValue({
        status: 'none',
        elements: [],
      });

      await service.processPendingEvents();
      expect(webhooksQueue.add).not.toHaveBeenCalled();
    });

    it('re-encola TODOS los eventos pendientes, por id', async () => {
      const pending = [
        buildEvent({ id: 'evt-a' }),
        buildEvent({ id: 'evt-b' }),
        buildEvent({ id: 'evt-c' }),
      ];
      webhookRepository.getPendingWebhookEvents.mockResolvedValue({
        status: 'found',
        elements: pending,
      });

      await service.processPendingEvents();

      expect(webhooksQueue.add).toHaveBeenNthCalledWith(
        1,
        WEBHOOKS_PROCESSOR_JOB_NAME,
        { id: 'evt-a' },
        {
          jobId: `${WEBHOOKS_PROCESSOR_JOB_NAME}_evt-a`,
        },
      );
      expect(webhooksQueue.add).toHaveBeenNthCalledWith(
        2,
        WEBHOOKS_PROCESSOR_JOB_NAME,
        { id: 'evt-b' },
        {
          jobId: `${WEBHOOKS_PROCESSOR_JOB_NAME}_evt-b`,
        },
      );
      expect(webhooksQueue.add).toHaveBeenNthCalledWith(
        3,
        WEBHOOKS_PROCESSOR_JOB_NAME,
        { id: 'evt-c' },
        {
          jobId: `${WEBHOOKS_PROCESSOR_JOB_NAME}_evt-c`,
        },
      );
      expect(webhooksQueue.add).toHaveBeenCalledTimes(3);
    });

    it('un enqueue que falla NO frena a los demás (no-starvation) y processPendingEvents resuelve', async () => {
      const pending = [
        buildEvent({ id: 'evt-ok-1' }),
        buildEvent({ id: 'evt-fails' }),
        buildEvent({ id: 'evt-ok-2' }),
      ];
      webhookRepository.getPendingWebhookEvents.mockResolvedValue({
        status: 'found',
        elements: pending,
      });

      webhooksQueue.add.mockImplementation((_job, data: { id: string }) =>
        data.id === 'evt-fails'
          ? Promise.reject(new Error('redis down'))
          : Promise.resolve({}),
      );

      await expect(service.processPendingEvents()).resolves.toBeUndefined();
      expect(webhooksQueue.add).toHaveBeenCalledTimes(3);
    });

    it('un enqueue que falla se loguea a nivel warn con el id del evento', async () => {
      const pending = [buildEvent({ id: 'evt-fails' })];
      webhookRepository.getPendingWebhookEvents.mockResolvedValue({
        status: 'found',
        elements: pending,
      });
      webhooksQueue.add.mockRejectedValueOnce(new Error('redis down'));

      await service.processPendingEvents();

      expect(logger.warn.mock.calls[0][0]).toMatchObject(
        expect.objectContaining({
          id: 'evt-fails',
        }),
      );
      expect(logger.warn).toHaveBeenCalledTimes(1);
    });
  });

  describe('WebhookService.reprocess (ADR-015)', () => {
    beforeEach(async () => {
      jest.clearAllMocks();
    });

    it('evento inexistente → EventNotFoundError, no flipea ni encola', async () => {
      webhookRepository.fetchEventById.mockResolvedValue(null);

      await expect(service.reprocess('missing')).rejects.toThrow(
        EventNotFoundError,
      );
      expect(webhookRepository.reactivateForReprocess).not.toHaveBeenCalled();
      expect(webhooksQueue.add).not.toHaveBeenCalled();
    });

    it('evento no está en pending_manual_review → EventNotReprocessableError, no encola', async () => {
      webhookRepository.fetchEventById.mockResolvedValue(
        buildEvent({ status: 'processed' }),
      );
      // el árbitro atómico rebota: 0 filas flipeadas → sin generación
      webhookRepository.reactivateForReprocess.mockResolvedValue(null);

      await expect(service.reprocess('evt-uuid')).rejects.toThrow(
        EventNotReprocessableError,
      );
      expect(webhooksQueue.add).not.toHaveBeenCalled();
    });

    it('muerto reprocesable → flipea y encola con jobId por-intento (_retry_${generation})', async () => {
      webhookRepository.fetchEventById.mockResolvedValue(
        buildEvent({ id: 'evt-dead', status: 'pending_manual_review' }),
      );
      // El flip DEVUELVE la generación nueva (retries ya incrementado). Antes se
      // contaban filas del anexo; ese número dejó de significar "veces que murió"
      // en cuanto los reintentos de la transición empezaron a dejar rastro.
      webhookRepository.reactivateForReprocess.mockResolvedValue(2);

      await service.reprocess('evt-dead');

      expect(webhookRepository.reactivateForReprocess).toHaveBeenCalledWith(
        'evt-dead',
      );
      expect(webhooksQueue.add).toHaveBeenCalledWith(
        WEBHOOKS_PROCESSOR_JOB_NAME,
        { id: 'evt-dead' },
        {
          jobId: `${WEBHOOKS_PROCESSOR_JOB_NAME}_evt-dead_retry_2`,
        },
      );
    });

    it('el jobId por-intento difiere del determinístico del path orgánico (evita el dedup de BullMQ)', async () => {
      webhookRepository.fetchEventById.mockResolvedValue(
        buildEvent({ id: 'evt-dead', status: 'pending_manual_review' }),
      );
      webhookRepository.reactivateForReprocess.mockResolvedValue(1);

      await service.reprocess('evt-dead');

      const organicJobId = `${WEBHOOKS_PROCESSOR_JOB_NAME}_evt-dead`;
      const usedJobId = webhooksQueue.add.mock.calls[0][2].jobId;
      expect(usedJobId).not.toBe(organicJobId);
    });
  });
});
