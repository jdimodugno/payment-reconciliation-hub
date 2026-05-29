import { CheckStatus } from '@/modules/health/health.types';
import { Pinger } from './pinger.interface';

export class FakeCachePinger implements Pinger {
  ping(): Promise<CheckStatus> {
    return new Promise<CheckStatus>((resolve) => {
      resolve('up');
    });
  }
}