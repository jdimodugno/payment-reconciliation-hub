import { DRIZZLE, DrizzleDB } from '@/shared/database/database.module';
import { Inject, Injectable } from '@nestjs/common';
import { DeadLetterEventData } from './dead-letter.types';
import { deadLetterEventsTable } from './dead-letter.schema';

@Injectable()
export class DeadLetterRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async append(deadLetterEventData: DeadLetterEventData): Promise<void> {
    try {
      await this.db.insert(deadLetterEventsTable).values({
        eventId: deadLetterEventData.eventId,
        lastError: deadLetterEventData.lastError,
        reason: deadLetterEventData.reason,
      });
    } catch (error) {
      console.error(
        'An error ocurred during dead letter event writing. ',
        error,
      );
    }
  }
}
