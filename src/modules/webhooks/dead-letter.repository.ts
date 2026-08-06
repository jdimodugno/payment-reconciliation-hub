import { DRIZZLE, DrizzleDB } from '@/shared/database/database.module';
import { Inject, Injectable } from '@nestjs/common';
import { DeadLetterEventData } from './dead-letter.types';
import { deadLetterEventsTable } from './dead-letter.schema';
import { countDistinct } from 'drizzle-orm';

@Injectable()
export class DeadLetterRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  // T5: the annex write MUST NOT fail silently. Swallowing here made
  // `append` a best-effort no-op: the caller (transitionToManualReview) got a
  // clean `void` and went on to flip the event to `pending_manual_review`,
  // leaving an event in manual review with NO annex row — the very evidence
  // that makes the failure auditable. The error propagates so the consumer
  // re-throws and BullMQ retries the whole transition (attempts: 3).
  //
  // Idempotent per death via UNIQUE (event_id, generation). `onConflictDoNothing`
  // is safe HERE — and was not safe in `DiscrepancyRepository.save` (ADR-017 D4) —
  // because this key captures everything that distinguishes one case from another:
  // a conflict can only mean "this death is already recorded", never "the same
  // death, but the facts changed". The BullMQ retries of a failed transition all
  // carry the same generation and converge onto one row; the next real death comes
  // after a reactivation flip, which bumps the generation and gets its own row.
  //
  // Note this does NOT weaken the rule above: a write failure still propagates.
  // Only the specific unique-violation is treated as expected convergence.
  async append(deadLetterEventData: DeadLetterEventData): Promise<void> {
    await this.db
      .insert(deadLetterEventsTable)
      .values({
        eventId: deadLetterEventData.eventId,
        generation: deadLetterEventData.generation,
        lastError: deadLetterEventData.lastError,
        reason: deadLetterEventData.reason,
      })
      .onConflictDoNothing();
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
