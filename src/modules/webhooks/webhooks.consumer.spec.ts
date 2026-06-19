import { Test } from '@nestjs/testing';
import { UnrecoverableError } from 'bullmq';
import { Job } from 'bullmq';
import { WebhooksConsumer } from './webhooks.consumer';
import { WebhookService } from './webhooks.service';
import { NonRetriableError } from '@/shared/exception/non-retriable.exception';

// Doble del service: solo nos importa processSingleEventById, que es lo que
// el consumer invoca. El resto del comportamiento del service NO es asunto
// de este test (eso ya se prueba en webhooks.service.spec.ts).
const webhookService = {
  processSingleEventById: jest.fn(),
};

let consumer: WebhooksConsumer;

// El consumer recibe job.data.id; el resto del Job no lo usa, así que un
// cast mínimo alcanza para el unit (no estamos probando BullMQ, sino la
// traducción error-de-dominio -> semántica-de-cola).
const buildJob = (id = 'evt-uuid'): Job<{ id: string }> =>
  ({ data: { id } }) as Job<{ id: string }>;

describe('WebhooksConsumer.process', () => {
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        WebhooksConsumer,
        { provide: WebhookService, useValue: webhookService },
      ],
    }).compile();
    consumer = moduleRef.get(WebhooksConsumer);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('camino feliz', () => {
    it('procesamiento OK → resuelve sin lanzar (job se completa)', async () => {
      webhookService.processSingleEventById.mockResolvedValue(undefined);
      await expect(consumer.process(buildJob())).resolves.toBeUndefined();
      expect(webhookService.processSingleEventById).toHaveBeenCalledWith(
        'evt-uuid',
      );
    });
  });

  describe('error RETRIABLE (transitorio)', () => {
    it('service tira Error genérico → consumer RE-LANZA el mismo error (BullMQ reintenta con backoff)', async () => {
      const transient = new Error('db hiccup');
      webhookService.processSingleEventById.mockRejectedValue(transient);
      await expect(consumer.process(buildJob())).rejects.toBe(transient);
    });
  });

  describe('error NO-RETRIABLE (permanente)', () => {
    it('service tira NonRetriableError → consumer lanza UnrecoverableError (BullMQ NO reintenta → failed set)', async () => {
      const permanent = new NonRetriableError('payload malformado');
      webhookService.processSingleEventById.mockRejectedValue(permanent);
      await expect(consumer.process(buildJob())).rejects.toBeInstanceOf(
        UnrecoverableError,
      );
      await expect(consumer.process(buildJob())).rejects.toThrow(
        permanent.message,
      );
    });
  });
});
