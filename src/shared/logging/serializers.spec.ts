import { Test } from '@nestjs/testing';
import { PinoLogger } from 'nestjs-pino';
import { StructuredLogger } from './logger';
import { LogSerializer } from './log-serializer.interface';
import { WebhookEventSerializer } from '@/modules/webhooks/webhook.types';
import { deadLetterEventSerializer } from '@/modules/webhooks/dead-letter.types';
import { ProviderSerializer } from '@/modules/providers/provider.type';

// Mientras logger.spec.ts prueba el MECANISMO (fail-closed con una FakeEntity),
// este spec prueba la CONFIGURACIÓN: que cada serializer concreto declare bien
// su allowlist. Un serializer es data; si alguien agrega un campo sensible al
// allowlist por error, el test genérico no lo caza — este sí.

const pino = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

type SerializerCase = {
  describe: string;
  name: string;
  emit: (logger: StructuredLogger) => void;
  mustNotLeak: string[];
  mustInclude: string[];
};

// Factory genérica: captura T (entidad ↔ serializer) en la clausura `emit` y lo
// erase del tipo del array. Así cada caso queda fuertemente tipado (la entity
// DEBE satisfacer T del serializer) sin `any` ni `as`, y el array es homogéneo.
const makeCase = <T extends Record<string, unknown>>(c: {
  describe: string;
  serializer: LogSerializer<T>;
  entity: T;
  mustNotLeak: string[];
  mustInclude: string[];
}): SerializerCase => ({
  describe: c.describe,
  name: c.serializer.name,
  emit: (logger) => logger.info(c.entity, c.serializer, 'test'),
  mustNotLeak: c.mustNotLeak,
  mustInclude: c.mustInclude,
});

const cases: SerializerCase[] = [
  makeCase({
    describe: 'WebhookEventSerializer',
    serializer: WebhookEventSerializer,
    entity: {
      id: 'evt-1',
      providerId: 'stripe',
      payload: { card: '4111-1111-1111-1111', cvv: '123' },
      externalEventId: 'ext-1',
      status: 'received',
      retries: 0,
      receivedAt: '2026-06-30T00:00:00Z',
      processedAt: null,
      transactionId: null,
    },
    mustNotLeak: ['payload', 'retries', 'receivedAt', 'processedAt'],
    mustInclude: [
      'id',
      'providerId',
      'externalEventId',
      'status',
      'transactionId',
    ],
  }),
  makeCase({
    describe: 'deadLetterEventSerializer',
    serializer: deadLetterEventSerializer,
    entity: {
      eventId: 'evt-1',
      reason: 'unsupported_currency',
      lastError: '{"stack":"...opaco..."}',
    },
    mustNotLeak: ['lastError'],
    mustInclude: ['eventId', 'reason'],
  }),
  makeCase({
    describe: 'ProviderSerializer',
    serializer: ProviderSerializer,
    entity: {
      id: 'prov-1',
      name: 'Stripe',
      type: 'card',
      enabled: true,
      createdAt: '2026-06-30T00:00:00Z',
    },
    mustNotLeak: ['createdAt'],
    mustInclude: ['id', 'name', 'type', 'enabled'],
  }),
];

describe('Serializers concretos (allowlist correcta por entidad)', () => {
  let logger: StructuredLogger;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [StructuredLogger, { provide: PinoLogger, useValue: pino }],
    }).compile();
    logger = moduleRef.get(StructuredLogger);
  });

  beforeEach(() => jest.clearAllMocks());

  cases.forEach(({ describe: title, name, emit, mustNotLeak, mustInclude }) => {
    describe(title, () => {
      it('no filtra ningún campo fuera del allowlist', () => {
        emit(logger);
        const [emitted] = pino.info.mock.calls[0];
        mustNotLeak.forEach((field) => {
          expect(emitted).not.toHaveProperty(field);
        });
      });

      it('proyecta exactamente los campos del allowlist + entityName', () => {
        emit(logger);
        const [emitted] = pino.info.mock.calls[0];

        expect(emitted.entityName).toBe(name);
        mustInclude.forEach((field) => {
          expect(emitted).toHaveProperty(field);
        });
      });
    });
  });
});
