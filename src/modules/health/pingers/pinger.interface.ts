import type { CheckStatus } from '@/modules/health/health.types';

export interface Pinger {
  ping(): Promise<CheckStatus>;
}
