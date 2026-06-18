import { NonRetriableError } from './non-retriable.exception';

export class InvariantViolationError extends NonRetriableError {
  constructor(message: string) {
    super(message);
    this.name = 'InvariantViolationError';
  }
}
