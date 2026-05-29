import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus } from '@nestjs/common';
import request from 'supertest';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

describe('HealthController', () => {
  let app: INestApplication | undefined;

  const buildApp = async (
    mockService: Partial<HealthService>,
  ): Promise<INestApplication> => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: HealthService, useValue: mockService }],
    }).compile();

    const instance = moduleRef.createNestApplication();
    await instance.init();
    return instance;
  };
  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  describe('GET /health/live', () => {
    it('should return 200 with status ok', async () => {
      app = await buildApp({
        checkLiveness: jest.fn().mockResolvedValue({ status: 'ok' }),
      });

      await request(app.getHttpServer())
        .get('/health/live')
        .expect(HttpStatus.OK)
        .expect({ status: 'ok' });
    });
  });

  describe('GET /health/ready', () => {
    it('should return 200 when status is ok', async () => {
      app = await buildApp({
        checkReadiness: jest.fn().mockResolvedValue({
          status: 'ok',
          checks: { db: 'up', cache: 'up' },
        }),
      });

      await request(app.getHttpServer())
        .get('/health/ready')
        .expect(HttpStatus.OK)
        .expect({ status: 'ok', checks: { db: 'up', cache: 'up' } });
    });

    it('should return 503 when status is down', async () => {
      app = await buildApp({
        checkReadiness: jest.fn().mockResolvedValue({
          status: 'down',
          checks: { db: 'down', cache: 'up' },
        }),
      });

      await request(app.getHttpServer())
        .get('/health/ready')
        .expect(HttpStatus.SERVICE_UNAVAILABLE)
        .expect({ status: 'down', checks: { db: 'down', cache: 'up' }});
    });
  });
});