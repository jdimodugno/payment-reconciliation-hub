import { DRIZZLE, DrizzleDB } from '@/shared/database/database.module';
import { Inject, Injectable } from '@nestjs/common';
import { transactionsTable } from './transaction.schema';
import { CreateTransactionData } from './dto/create-transaction.dto';
import { Transaction } from './transaction.types';
import { Money } from '@/shared/money/money';
import { isValidCurrency } from '@/shared/money/currency';

@Injectable()
export class TransactionsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async create(data: CreateTransactionData): Promise<Transaction> {
    const row = (
      await this.db
        .insert(transactionsTable)
        .values({
          externalId: data.externalId,
          providerId: data.providerId,
          amount: data.amount,
          currency: data.currency,
          status: data.status,
          type: data.type,
          metadata: data.metadata,
        })
        .returning()
    )[0];

    if (!isValidCurrency(row.currency)) {
      throw new Error(`Invalid currency from DB: ${row.currency}`);
    }

    return {
      id: row.id,
      externalId: row.externalId,
      providerId: row.providerId,
      amount: Money.fromDecimal(row.amount, row.currency),
      currency: row.currency,
      createdAt: row.createdAt.toISOString(),
      status: row.status,
      type: row.type,
      metadata: row.metadata ?? null,
    };
  }
}
