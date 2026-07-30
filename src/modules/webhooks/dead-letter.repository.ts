import { DRIZZLE, DrizzleDB } from '@/shared/database/database.module';
import { Inject, Injectable } from '@nestjs/common';
import { DeadLetterEventData } from './dead-letter.types';
import { deadLetterEventsTable } from './dead-letter.schema';
import { countDistinct, eq, sql } from 'drizzle-orm';

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

  // ADR-015: el count de filas del anexo para un evento = cuántas veces murió =
  // número de intento. Se usa como sufijo del jobId de reinyección (`_retry_${n}`),
  // dando un jobId fresco por intento (BullMQ deduplica por jobId; el determinístico
  // que protege el path orgánico estorbaría al reprocess) + rastro del intento.
  async getFailureCountForEvent(eventId: string): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(deadLetterEventsTable)
      .where(eq(deadLetterEventsTable.eventId, eventId));

    return row.count;
  }

  async getDistinctEventIdCount(): Promise<number | null> {
    try {
      const [deadLettered] = await this.db
        .select({ events: countDistinct(deadLetterEventsTable.eventId) })
        .from(deadLetterEventsTable);

      return deadLettered.events;
    } catch (error) {
      console.error(
        'An error ocurred during dead letter event reading. ',
        error,
      );
      return null;
    }
  }
}
