import { Inject, Injectable } from '@nestjs/common';
import type { CheckStatus, LivenessReport, ReadinessReport, ReadinessStatus } from '@/modules/health/health.types';
import { CACHE_PINGER, DB_PINGER } from './pingers/tokens';
import { Pinger } from './pingers/pinger.interface';

@Injectable()
export class HealthService {
  constructor(
    @Inject(DB_PINGER) private readonly dbPinger: Pinger,
    @Inject(CACHE_PINGER) private readonly cachePinger: Pinger,
  ) {}

  private pingDatabase():  Promise<CheckStatus> {
    return this.dbPinger.ping();
  }

  private pingCache(): Promise<CheckStatus> {
    return this.cachePinger.ping();
  }

  async checkLiveness(): Promise<LivenessReport> {
    return ({
      status: 'ok',
    });
  }

  async checkReadiness(): Promise<ReadinessReport> {
    const [db, cache] = await Promise.all([
      this.pingDatabase(),
      this.pingCache(),
    ]);

    const status: ReadinessStatus = (db === 'up' && cache === 'up') ? 'ok' : 'down';

    return ({
      status,
      checks: {
        db,
        cache
      }
    });
  }
}