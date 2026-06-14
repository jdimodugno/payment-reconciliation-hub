import { Test } from '@nestjs/testing';
import { WebhookService } from './webhooks.service';
import { WebhookRepository } from './webhooks.repository';
import { ProvidersService } from '../providers/providers.service';
import { PendingManualReviewReason, WebhookEvent } from './webhook.types';
import z from 'zod';
import {
  WEBHOOKS_PROCESSOR_JOB_NAME,
  WEBHOOKS_QUEUE_NAME,
} from './webhook.constants';
import { getQueueToken } from '@nestjs/bullmq';
import { EventNotFoundError } from './webhook.exception';

const webhookRepository = {
  setEventForManualReview: jest.fn(),
  markEventAsProcessed: jest.fn(),
  getPendingWebhookEvents: jest.fn(),
  findUnprocessedEvents: jest.fn(),
  fetchEventById: jest.fn(),
  create: jest.fn(),
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
    reason: null,
    ...overrides,
  }) as WebhookEvent;

describe('WebhookService', () => {
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        WebhookService,
        { provide: WebhookRepository, useValue: webhookRepository },
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

    describe('guard: retries agotados', () => {
      it('retries >= MAX → setEventForManualReview(RETRIES_EXHAUSTED) y NO llama markEventAsProcessed', async () => {
        const event = buildEvent({ retries: 3 });
        await service.processSingleEvent(event);
        expect(webhookRepository.markEventAsProcessed).not.toHaveBeenCalled();
        expect(webhookRepository.setEventForManualReview).toHaveBeenCalledWith(
          event.id,
          PendingManualReviewReason.RETRIES_EXHAUSTED,
        );
      });
    });

    describe('guard: currency no soportada', () => {
      it('currency inválida → setEventForManualReview(UNSUPPORTED_CURRENCY) y NO procesa', async () => {
        const event = buildEvent();
        providerInstance.fetchDetails.mockResolvedValue({
          ...event,
          currency: 'axsd',
          type: 'payment.succeeded',
          amount: '20',
          externalId: 'x',
          externalEventId: 'e',
          rawEventData: {},
        });
        await service.processSingleEvent(event);
        expect(webhookRepository.markEventAsProcessed).not.toHaveBeenCalled();
        expect(webhookRepository.setEventForManualReview).toHaveBeenCalledWith(
          event.id,
          PendingManualReviewReason.UNSUPPORTED_CURRENCY,
        );
      });
    });

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
        expect(webhookRepository.setEventForManualReview).toHaveBeenCalledWith(
          event.id,
          PendingManualReviewReason.UNSUPPORTED_EVENT_TYPE,
        );
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

  describe('WebhookService.findUnprocessedEvents', () => {
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

    it('deriva ageInDays correcto y receivedAt como ISO string', async () => {
      webhookRepository.findUnprocessedEvents.mockResolvedValue([
        rowReceivedDaysAgo('evt-10d', 10),
        rowReceivedDaysAgo('evt-3d', 3),
        rowReceivedDaysAgo('evt-0d', 0),
      ]);

      const result = await service.findUnprocessedEvents();

      expect(result[0].ageInDays).toBe(10);
      expect(z.iso.datetime().safeParse(result[0].receivedAt).success).toBe(
        true,
      );
      expect(result[1].ageInDays).toBe(3);
      expect(z.iso.datetime().safeParse(result[1].receivedAt).success).toBe(
        true,
      );
      expect(result[2].ageInDays).toBe(0);
      expect(z.iso.datetime().safeParse(result[2].receivedAt).success).toBe(
        true,
      );
    });

    it('repo vacío → []', async () => {
      webhookRepository.findUnprocessedEvents.mockResolvedValue([]);
      const result = await service.findUnprocessedEvents();
      expect(result.length).toBe(0);
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

    it('tras persistir, encola por id con attempts:1 y jobId compuesto', async () => {
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
          attempts: 1,
          jobId: `${WEBHOOKS_PROCESSOR_JOB_NAME}_evt-enqueue`,
        },
      );
    });
  });
});
