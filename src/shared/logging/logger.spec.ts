import { Test } from '@nestjs/testing';
import { PinoLogger } from 'nestjs-pino';
import { StructuredLogger } from './logger';
import { LogSerializer } from './log-serializer.interface';

// Doble de PinoLogger: solo nos importa CON QUÉ se lo invoca (el objeto que
// se emite), no que escriba en ningún lado. La emisión real de JSON es asunto
// de pino, no de este wrapper. Acá probamos el CONTRATO de proyección.
const pino = {
  warn: jest.fn(),
  error: jest.fn(),
};

// Fixture genérico a propósito: `Logger` es shared/mecanismo. Su garantía es
// "lo que no está en el allowlist NO se emite" — independiente de qué entidad
// sea. `secret` representa cualquier campo sensible (el `lastError` del
// dead-letter es una INSTANCIA de este caso, no el caso en sí).
type FakeEntity = {
  id: string;
  safe: string;
  secret: string;
};

const fakeSerializer: LogSerializer<FakeEntity> = {
  name: 'FakeEntity',
  allowlist: ['id', 'safe'], // `secret` deliberadamente afuera
};

const buildEntity = (): FakeEntity => ({
  id: 'entity-1',
  safe: 'ok-to-log',
  secret: 'NEVER-LOG-THIS',
});

describe('Logger (allowlist fail-closed)', () => {
  let logger: StructuredLogger;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [StructuredLogger, { provide: PinoLogger, useValue: pino }],
    }).compile();
    logger = moduleRef.get(StructuredLogger);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // EL test que protege el diseño: aunque la entidad TRAIGA un campo sensible,
  // si no está en el allowlist no puede llegar al log. Si alguien mete `secret`
  // al allowlist por error, este test se pone rojo y lo frena.
  it('no emite campos fuera del allowlist, aunque la entidad los traiga', () => {
    logger.warn(buildEntity(), fakeSerializer, 'evento de prueba');

    // primer arg = el objeto de campos; segundo arg = el mensaje
    const [emittedFields, msg] = pino.warn.mock.calls[0];

    expect(emittedFields).not.toHaveProperty('secret'); // ← la garantía fail-closed
    expect(emittedFields).toMatchObject({
      entityName: 'FakeEntity', // metadata de sistema, siempre presente
      id: 'entity-1',
      safe: 'ok-to-log',
    });
    expect(msg).toBe('evento de prueba');
  });

  // El `err` es contexto del fallo, vive FUERA del allowlist: se compone en el
  // call-site (clave `err`, que pino serializa especial) y solo aparece si se
  // pasó. Confirma que la frontera sistema-vs-dominio se respeta.
  it('incluye `err` solo cuando se lo pasa', () => {
    const boom = new Error('boom');

    logger.error(buildEntity(), fakeSerializer, 'algo falló', boom);
    expect(pino.error.mock.calls[0][0]).toHaveProperty('err', boom);

    logger.error(buildEntity(), fakeSerializer, 'sin error');
    expect(pino.error.mock.calls[1][0]).not.toHaveProperty('err');
  });
});
