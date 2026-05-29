import { CheckStatus } from '@/modules/health/health.types';
import { Pinger } from './pinger.interface';

export class FakeDbPinger implements Pinger {
  ping(): Promise<CheckStatus> {
    return new Promise<CheckStatus>((resolve) => {
      resolve('up');
    });
  }
}