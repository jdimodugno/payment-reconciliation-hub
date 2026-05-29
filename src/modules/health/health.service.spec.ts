import { Test, TestingModule } from '@nestjs/testing';
import { HealthService } from './health.service';
import { DB_PINGER, CACHE_PINGER } from './pingers/tokens';
import { Pinger } from './pingers/pinger.interface';
import { CheckStatus } from './health.types';

class StubPinger implements Pinger {
  constructor(private readonly result: CheckStatus) {}
  ping(): Promise<CheckStatus> {
    return Promise.resolve(this.result);
  }
}

describe('HealthService', () => {
  const buildService = async (
    dbResult: CheckStatus,
    cacheResult: CheckStatus,
  ): Promise<HealthService> => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        { provide: DB_PINGER, useValue: new StubPinger(dbResult) },
        { provide: CACHE_PINGER, useValue: new StubPinger(cacheResult) },
      ],
    }).compile();

    return module.get<HealthService>(HealthService);
  };

  describe('checkLiveness', () => {
    it('should return status ok', async () => {
      const service = await buildService('up', 'up');
      const result = await service.checkLiveness();
      expect(result).toEqual({ status: 'ok' });
    });
  });

  describe('checkReadiness', () => {
    it('should return ok when all checks are up', async () => {
      const service = await buildService('up', 'up');
      const result = await service.checkReadiness();
      expect(result).toEqual({
        status: 'ok',
        checks: { db: 'up', cache: 'up' },
      });
    });

    it('should return down when db is down', async () => {
      const service = await buildService('down', 'up');
      const result = await service.checkReadiness();
      expect(result).toEqual({
        status: 'down',
        checks: { db: 'down', cache: 'up' },
      });
    });

    it('should return down when cache is down', async () => {
      const service = await buildService('up', 'down');
      const result = await service.checkReadiness();
      expect(result).toEqual({
        status: 'down',
        checks: { db: 'up', cache: 'down' },
      });
    });

    it('should return down when both are down', async () => {
      const service = await buildService('down', 'down');
      const result = await service.checkReadiness();
      expect(result).toEqual({
        status: 'down',
        checks: { db: 'down', cache: 'down' },
      });
    });
  });
});
