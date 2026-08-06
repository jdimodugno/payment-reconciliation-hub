import { LogSerializer } from '@/shared/logging/log-serializer.interface';
import { webhookEventStatusEnum } from './webhook.schema';
import { TransactionStatus } from '../transactions/transaction.types';
import { Currencies } from '@/shared/money/currency';

// UNSUPPORTED_CURRENCY was removed: nothing could produce it. The guard that
// used it sat after enrichment, which rejects an unknown currency first, so the
// reason named a state the system never reaches. Unreachable vocabulary reads
// as a covered case and hides that the path is not handled.
export enum PendingManualReviewReason {
  UNSUPPORTED_EVENT_TYPE = 'unsupported_event_type',
}

export type WebhookEventStatus =
  (typeof webhookEventStatusEnum.enumValues)[number];

export type ProcessWebhookEventResultStatus =
  | 'failed'
  | 'processed'
  | 'already_processed';

export type ProcessWebhookEventResult = {
  status: ProcessWebhookEventResultStatus;
};

export type WebhookEvent = {
  id: string;
  providerId: string;
  payload: unknown;
  externalEventId: string;
  status: WebhookEventStatus;
  retries: number;
  receivedAt: string;
  processedAt: string | null;
  transactionId: string | null;
};

export type UnprocessedEventRow = {
  id: string;
  receivedAt: Date;
};

export type UnprocessedEvent = Omit<UnprocessedEventRow, 'receivedAt'> & {
  receivedAt: string;
  ageInDays: number;
};

export type SuccessfulReconciliationStatus = {
  unprocessedEvents: UnprocessedEvent[];
  deadLetteredEvents: number;
  eventsByStatus: { processed: number; pendingManualReview: number };
  total: number;
};

// The degraded `{ error }` arm is gone: a failed read is unexpected
// infrastructure failure, not a domain outcome, so it propagates and the HTTP
// boundary answers 500 instead of a 200 that monitoring counts as success.
export type ReconciliationStatus = SuccessfulReconciliationStatus;

/**
 * Lo que el PROVIDER dice de un pago, re-derivado desde los eventos recibidos.
 *
 * Forma propia de este módulo a propósito (ADR-017 D1): `reconciliation/` la
 * traduce a la que compara su matcher. Si acá viviera `ProviderSide`, `webhooks/`
 * importaría tipos de `reconciliation/` y la dependencia sería mutua.
 *
 * `status` es el eje común de comparación; `rawStatus` es la señal cruda del
 * provider, que se guarda para auditoría (ADR-013 / d25: se compara por status,
 * se almacena raw).
 */
export type ProviderSideEvent = {
  providerId: string;
  providerRef: string;
  amount: string;
  currency: Currencies;
  status: TransactionStatus;
  rawStatus: string;
};

/**
 * `unreadable` viaja al lado del resultado a propósito: un evento que no se pudo
 * enriquecer no es una ausencia, y colapsarlo en la lista vacía haría que el
 * matcher lo reporte como `missing_provider` —un hallazgo inventado—. Es la misma
 * distinción de ADR-016: "no pude leer" no es "leí 0".
 */
export type ProviderSideEventsResult = {
  events: ProviderSideEvent[];
  unreadable: number;
};

export const WebhookEventSerializer: LogSerializer<WebhookEvent> = {
  name: 'WebhookEvent',
  allowlist: ['id', 'providerId', 'externalEventId', 'status', 'transactionId'],
};
