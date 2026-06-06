import { DRIZZLE, DrizzleDB } from '@/shared/database/database.module';
import { Inject, Injectable } from '@nestjs/common';
import { WebhookEvent } from './webhook.types';
import { webhooksTable } from './webhook.schema';
import { eq } from 'drizzle-orm';
import { DatabaseError } from 'pg';
import { NewWebhookEvent } from './dto/new-webhook.dto';

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
}
