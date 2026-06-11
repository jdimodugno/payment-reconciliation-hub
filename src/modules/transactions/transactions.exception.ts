import { EntityNotFoundError } from '@/shared/exception/entity-not-found.exception';

export class TransactionNotFoundError extends EntityNotFoundError {
  constructor(id: string) {
    super('Transaction', id);
  }
}
