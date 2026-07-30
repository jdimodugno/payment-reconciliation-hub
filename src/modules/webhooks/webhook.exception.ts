import { NonRetriableError } from '@/shared/exception/non-retriable.exception';
import { EntityNotFoundError } from '@/shared/exception/entity-not-found.exception';
import { ConflictError } from '@/shared/exception/conflict.exception';
import { WebhookEventStatus } from './webhook.types';

export class UnableToPersistTransactionError extends Error {
  constructor(externalEventId: string) {
    super(`External event: ${externalEventId} cannot persist transaction`);
    this.name = 'UnableToPersistTransactionError';
  }
}

export class AlreadyProcessedError extends Error {
  constructor(externalEventId: string) {
    super(`External event: ${externalEventId} is already processed`);
    this.name = 'AlreadyProcessedError';
  }
}

export class UnableToEnqueueEventError extends Error {
  constructor(eventId: string, cause: unknown) {
    super(`Unable to enqueue ${eventId} for processing`, {
      cause,
    });
    this.name = 'UnableToEnqueueEventError';
  }
}

export class EventNotFoundError extends EntityNotFoundError {
  constructor(id: string) {
    super('WebhookEvent', id);
    this.name = 'EventNotFoundError';
  }
}

export class EventNotReprocessableError extends ConflictError {
  constructor(id: string, currentStatus: WebhookEventStatus) {
    super(
      `Event ${id} is not reprocessable: only 'pending_manual_review' events can be reinjected, but current status is '${currentStatus}'`,
    );
    this.name = 'EventNotReprocessableError';
  }
}

export class MalformedProviderEventError extends NonRetriableError {
  constructor(payload: unknown) {
    super(
      `Event is malformed, cannot be processed nor processed. Payload: ${JSON.stringify(payload)}`,
    );
    this.name = 'MalformedProviderEventError';
  }
}
