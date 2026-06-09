import { Test } from '@nestjs/testing';
import { WebhookService } from './webhooks.service';
import { WebhookRepository } from './webhooks.repository';
import { ProvidersService } from '../providers/providers.service';
import { PendingManualReviewReason, WebhookEvent } from './webhook.types';

// Mocks de las dependencias del service (política/guards aislada de DB y providers reales).
const webhookRepository = {
  setEventForManualReview: jest.fn(),
  markEventAsProcessed: jest.fn(),
  getPendingWebhookEvents: jest.fn(),
  create: jest.fn(),
};

// providerInstance simula parseWebhook/fetchDetails; ajustá el retorno por test.
const providerInstance = {
  name: 'MOCK_STRIPE',
  parseWebhook: jest.fn(),
  fetchDetails: jest.fn(),
};

const providersService = {
  isValidProvider: jest.fn().mockResolvedValue({ name: 'stripe' }),
  getPaymentProviderInstance: jest.fn().mockReturnValue(providerInstance),
};

// Helper para construir un WebhookEvent pendiente; sobreescribí lo que cada test necesite.
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
      await service.processSingleEvent(event);
      expect(webhookRepository.markEventAsProcessed).toHaveBeenCalledWith(
        enriched,
        expect.objectContaining({ type: 'payin', status: 'settled' }),
      );
    });
  });
});
