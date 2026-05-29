export type LivenessStatus = 'ok';
export type CheckStatus = 'up' | 'down';
export type ReadinessStatus = 'ok' | 'down';

export type LivenessReport = {
  status: LivenessStatus;
};

export type ReadinessReport = {
  status: ReadinessStatus;
  checks: {
    db: CheckStatus;
    cache: CheckStatus;
  }
};