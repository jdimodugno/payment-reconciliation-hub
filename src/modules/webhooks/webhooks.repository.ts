import { DRIZZLE, DrizzleDB } from '@/shared/database/database.module';
import { Inject, Injectable } from '@nestjs/common';
import {
  ProcessWebhookEventResult,
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
import { isValidCurrency } from '@/shared/money/currency';
import {
  AlreadyProcessedError,
  UnableToPersistTransactionError,
} from './webhook.exception';

@Injectable()
export class WebhookRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

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
      const dbTransactionResult = await this.db.transaction(async (tx) => {
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
          throw new UnableToPersistTransactionError(
            `External event: ${eventData.externalEventId} cannot persist transaction`,
          );
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
          throw new AlreadyProcessedError(
            `External event: ${eventData.externalEventId} is already processed`,
          );
        }

        return {
          result: {
            event: claim[0],
            tx: txRow[0],
          },
        };
      });

      const { event, tx } = dbTransactionResult.result;

      if (!isValidCurrency(tx.currency)) {
        throw new Error(
          `Cannot map currency ${tx.currency} to a valid currency.`,
        );
      }

      if (event.processedAt === null) {
        throw new Error(
          'Missing required field "processedAt" for a webhook event with "processed" status',
        );
      }

      return { status: 'processed' };
    } catch (error) {
      if (error instanceof AlreadyProcessedError) {
        return {
          status: 'already_processed',
        };
      }

      console.error(
        `Failed attempt to process external event: ${eventData.externalEventId}`,
      );
      await this.db
        .update(webhooksTable)
        .set({
          retries: sql`${webhooksTable.retries} + 1`,
        })
        .where(
          and(
            eq(webhooksTable.externalEventId, eventData.externalEventId),
            eq(webhooksTable.providerId, transactionData.providerId),
          ),
        );

      throw error;
    }
  }

  async setEventForManualReview(
    eventId: string,
    reason: string,
  ): Promise<void> {
    await this.db
      .update(webhooksTable)
      .set({
        status: 'pending_manual_review',
        reason,
      })
      .where(eq(webhooksTable.id, eventId));
  }
}
