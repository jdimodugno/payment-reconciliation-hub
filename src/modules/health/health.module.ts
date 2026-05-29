import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { FakeCachePinger } from './pingers/fake-cache.pinger';
import { FakeDbPinger } from './pingers/fake-db.pinger';
import { DB_PINGER, CACHE_PINGER } from './pingers/tokens';

@Module({
  controllers: [HealthController],
  providers: [
    HealthService,
    { provide: DB_PINGER, useClass: FakeDbPinger },
    { provide: CACHE_PINGER, useClass: FakeCachePinger },
  ],
})
export class HealthModule {}
