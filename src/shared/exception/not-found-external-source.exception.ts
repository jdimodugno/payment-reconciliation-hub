import { NonRetriableError } from './non-retriable.exception';

export class NotFoundInExternalSourceError extends NonRetriableError {
  constructor(entityId: string, source: string) {
    super(`Entity with id "${entityId}" not found in provider "${source}"`);
    this.name = 'NotFoundInExternalSourceError';
  }
}
