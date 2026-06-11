import { Test } from '@nestjs/testing';
import { WebhookService } from './webhooks.service';
import { WebhookRepository } from './webhooks.repository';
import { ProvidersService } from '../providers/providers.service';
import { PendingManualReviewReason, WebhookEvent } from './webhook.types';
import z from 'zod';

const webhookRepository = {
  setEventForManualReview: jest.fn(),
  markEventAsProcessed: jest.fn(),
  getPendingWebhookEvents: jest.fn(),
  findUnprocessedEvents: jest.fn(),
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
};

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

describe('WebhookService.processSingleEvent', () => {
  let service: WebhookService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        WebhookService,
        { provide: WebhookRepository, useValue: webhookRepository },
        { provide: ProvidersService, useValue: providersService },
      ],
    }).compile();
    service = moduleRef.get(WebhookService);
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
  let service: WebhookService;

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
    const moduleRef = await Test.createTestingModule({
      providers: [
        WebhookService,
        { provide: WebhookRepository, useValue: webhookRepository },
        { provide: ProvidersService, useValue: providersService },
      ],
    }).compile();
    service = moduleRef.get(WebhookService);
  });

  it('deriva ageInDays correcto y receivedAt como ISO string', async () => {
    webhookRepository.findUnprocessedEvents.mockResolvedValue([
      rowReceivedDaysAgo('evt-10d', 10),
      rowReceivedDaysAgo('evt-3d', 3),
      rowReceivedDaysAgo('evt-0d', 0),
    ]);

    const result = await service.findUnprocessedEvents();

    expect(result[0].ageInDays).toBe(10);
    expect(z.iso.datetime().safeParse(result[0].receivedAt).success).toBe(true);
    expect(result[1].ageInDays).toBe(3);
    expect(z.iso.datetime().safeParse(result[1].receivedAt).success).toBe(true);
    expect(result[2].ageInDays).toBe(0);
    expect(z.iso.datetime().safeParse(result[2].receivedAt).success).toBe(true);
  });

  it('repo vacío → []', async () => {
    webhookRepository.findUnprocessedEvents.mockResolvedValue([]);
    const result = await service.findUnprocessedEvents();
    expect(result.length).toBe(0);
  });
});
