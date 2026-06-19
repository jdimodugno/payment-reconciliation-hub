import { NonRetriableError } from '@/shared/exception/non-retriable.exception';

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

export class EventNotFoundError extends Error {
  constructor(id: string) {
    super(`Unable to find event with id: ${id}`);
    this.name = 'EventNotFoundError';
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
