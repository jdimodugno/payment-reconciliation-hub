import { DRIZZLE, DrizzleDB } from '@/shared/database/database.module';
import { Inject, Injectable } from '@nestjs/common';
import { DeadLetterEventData } from './dead-letter.types';
import { deadLetterEventsTable } from './dead-letter.schema';
import { countDistinct, eq, sql } from 'drizzle-orm';

@Injectable()
export class DeadLetterRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  // T5: the annex write MUST NOT fail silently. Swallowing here made
  // `append` a best-effort no-op: the caller (transitionToManualReview) got a
  // clean `void` and went on to flip the event to `pending_manual_review`,
  // leaving an event in manual review with NO annex row — the very evidence
  // that makes the failure auditable. The error propagates so the consumer
  // re-throws and BullMQ retries the whole transition (attempts: 3).
  async append(deadLetterEventData: DeadLetterEventData): Promise<void> {
    await this.db.insert(deadLetterEventsTable).values({
      eventId: deadLetterEventData.eventId,
      lastError: deadLetterEventData.lastError,
      reason: deadLetterEventData.reason,
    });
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

  // A read failure here is unexpected infrastructure failure, not a domain
  // outcome: "could not read" is not "read zero". The previous `null` fused
  // both and dropped the cause on the floor, so the caller could only report a
  // generic error with a 200. Letting it propagate keeps the cause attached and
  // lets the HTTP boundary answer 500 — an overseer endpoint that returns 200
  // while saying "an error occurred" is counted as success by monitoring.
  async getDistinctEventIdCount(): Promise<number> {
    const [deadLettered] = await this.db
      .select({ events: countDistinct(deadLetterEventsTable.eventId) })
      .from(deadLetterEventsTable);

    return deadLettered.events;
  }
}
