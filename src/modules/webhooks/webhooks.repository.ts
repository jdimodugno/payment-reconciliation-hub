import { DRIZZLE, DrizzleDB } from '@/shared/database/database.module';
import { Inject, Injectable } from '@nestjs/common';
import {
  ProcessWebhookEventResult,
  SuccessfulReconciliationStatus,
  UnprocessedEventRow,
  WebhookEvent,
} from './webhook.types';
import { webhooksTable } from './webhook.schema';
import { and, asc, eq, isNull, or, sql } from 'drizzle-orm';
import { DatabaseError } from 'pg';
import { NewWebhookEvent } from './dto/new-webhook.dto';
import { EnrichedProviderEvent } from '../providers/provider-event.type';
import { transactionsTable } from '../transactions/transaction.schema';
import { UpsertTransactionData } from '../transactions/dto/create-transaction.dto';
import {
  AlreadyProcessedError,
  UnableToPersistTransactionError,
} from './webhook.exception';
import { InvariantViolationError } from '@/shared/exception/invariant-violation.exception';

@Injectable()
export class WebhookRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async fetchEventById(id: string): Promise<WebhookEvent | null> {
    const [row] = await this.db
      .select()
      .from(webhooksTable)
      .where(eq(webhooksTable.id, id));

    return row
      ? {
          ...row,
          receivedAt: row.receivedAt.toISOString(),
          processedAt: row.processedAt?.toISOString() ?? null,
        }
      : null;
  }

  // See DeadLetterRepository.getDistinctEventIdCount: a read failure is
  // unexpected infrastructure failure, not a domain outcome. It propagates with
  // its cause instead of collapsing into a `null` that means "could not read".
  async getEventsInTerminalStatusCountByGroup(): Promise<
    SuccessfulReconciliationStatus['eventsByStatus']
  > {
    const [row] = await this.db
      .select({
        processed:
          sql<number>`count(*) filter (where ${webhooksTable.status} = ${'processed'})`.mapWith(
            Number,
          ),
        pendingManualReview:
          sql<number>`count(*) filter (where ${webhooksTable.status} = ${'pending_manual_review'})`.mapWith(
            Number,
          ),
      })
      .from(webhooksTable);
    return row;
  }

  async create(
    data: NewWebhookEvent,
  ): Promise<{ status: 'created' | 'existed'; event: WebhookEvent }> {
    try {
      const row = (
        await this.db
          .insert(webhooksTable)
          .values({
            externalEventId: data.externalEventId,
            providerId: data.providerId,
            status: data.status,
            payload: data.payload,
          })
          .returning()
      )[0];

      return {
        status: 'created',
        event: {
          ...row,
          receivedAt: row.receivedAt.toISOString(),
          processedAt: row.processedAt?.toISOString() ?? null,
        },
      };
    } catch (error) {
      if (
        error instanceof Error &&
        error.cause instanceof DatabaseError &&
        'code' in error.cause &&
        error.cause.code === '23505'
      ) {
        const previouslyCreatedRow = (
          await this.db
            .select()
            .from(webhooksTable)
            .where(eq(webhooksTable.externalEventId, data.externalEventId))
        )[0];

        return {
          status: 'existed',
          event: {
            ...previouslyCreatedRow,
            receivedAt: previouslyCreatedRow.receivedAt.toISOString(),
            processedAt:
              previouslyCreatedRow.processedAt?.toISOString() ?? null,
          },
        };
      }
      throw error;
    }
  }

  async findUnprocessedEvents(): Promise<UnprocessedEventRow[]> {
    const events = await this.db
      .select({
        id: webhooksTable.id,
        receivedAt: webhooksTable.receivedAt,
      })
      .from(webhooksTable)
      .where(
        and(
          or(
            eq(webhooksTable.status, 'received'),
            eq(webhooksTable.status, 'pending_manual_review'),
          ),
          isNull(webhooksTable.processedAt),
        ),
      )
      .orderBy(asc(webhooksTable.receivedAt));

    return events;
  }

  async getPendingWebhookEvents(): Promise<{
    status: 'none' | 'found';
    elements: WebhookEvent[];
  }> {
    const pendingEvents = await this.db
      .select()
      .from(webhooksTable)
      .where(
        and(
          eq(webhooksTable.status, 'received'),
          isNull(webhooksTable.processedAt),
          isNull(webhooksTable.transactionId),
        ),
      );

    return {
      status: pendingEvents.length ? 'found' : 'none',
      elements: pendingEvents.map((evt) => ({
        ...evt,
        receivedAt: evt.receivedAt.toISOString(),
        processedAt: null,
      })),
    };
  }

  async markEventAsProcessed(
    eventData: EnrichedProviderEvent,
    transactionData: UpsertTransactionData,
  ): Promise<ProcessWebhookEventResult> {
    try {
      await this.db.transaction(async (tx) => {
        const txRow = await tx
          .insert(transactionsTable)
          .values(transactionData)
          .onConflictDoUpdate({
            target: [
              transactionsTable.providerId,
              transactionsTable.externalId,
            ],
            set: {
              ...transactionData,
            },
          })
          .returning();

        if (txRow.length === 0) {
          throw new UnableToPersistTransactionError(eventData.externalEventId);
        }

        const claim = await tx
          .update(webhooksTable)
          .set({
            status: 'processed',
            processedAt: sql`now()`,
            transactionId: txRow[0].id,
          })
          .where(
            and(
              eq(webhooksTable.status, 'received'),
              isNull(webhooksTable.processedAt),
              isNull(webhooksTable.transactionId),
            ),
          )
          .returning();

        if (claim.length === 0) {
          throw new AlreadyProcessedError(eventData.externalEventId);
        }

        if (claim[0].status === 'processed' && claim[0].processedAt === null) {
          throw new InvariantViolationError(
            'Missing required field "processedAt" for a webhook event with "processed" status',
          );
        }
      });

      return { status: 'processed' };
    } catch (error) {
      if (error instanceof AlreadyProcessedError) {
        return {
          status: 'already_processed',
        };
      }
      // Infra does not log what it propagates (d21: log at the domain decision
      // point). Everything below re-throws, so whoever decides what the failure
      // means — the consumer — owns the log. Logging here as well produced a
      // duplicate entry and bypassed the ADR-012 structured logger. Removing it
      // left the `InvariantViolationError` branch identical to the fallthrough:
      // it only ever existed to log a different message.
      throw error;
    }
  }

  async setEventForManualReview(eventId: string): Promise<void> {
    await this.db
      .update(webhooksTable)
      .set({
        status: 'pending_manual_review',
      })
      .where(eq(webhooksTable.id, eventId));
  }

  // ADR-015: reinyección por flip transitorio. El WHERE en 'pending_manual_review'
  // es el ÁRBITRO atómico: solo revive un muerto, nunca toca un 'processed' ni un
  // 'received' orgánico. Bajo reprocess concurrente, solo uno gana (returning vacío
  // para el resto). `processed_at`/`transaction_id` de un muerto no-procesado ya
  // están en null → no requieren reset.
  async reactivateForReprocess(eventId: string): Promise<boolean> {
    const reactivated = await this.db
      .update(webhooksTable)
      .set({ status: 'received' })
      .where(
        and(
          eq(webhooksTable.id, eventId),
          eq(webhooksTable.status, 'pending_manual_review'),
        ),
      )
      .returning({ id: webhooksTable.id });

    return reactivated.length > 0;
  }
}
