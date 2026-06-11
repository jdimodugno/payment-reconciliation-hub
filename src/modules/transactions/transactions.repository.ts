import { DRIZZLE, DrizzleDB } from '@/shared/database/database.module';
import { Inject, Injectable } from '@nestjs/common';
import { transactionsTable } from './transaction.schema';
import { CreateTransactionData } from './dto/create-transaction.dto';
import { Transaction } from './transaction.types';
import { eq } from 'drizzle-orm';
import { mapRowToTransaction } from './mapper/row-transaction.mapper';

@Injectable()
export class TransactionsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async create(data: CreateTransactionData): Promise<Transaction> {
    const row = (
      await this.db.insert(transactionsTable).values(data).returning()
    )[0];

    return mapRowToTransaction(row);
  }

  async findById(id: string): Promise<Transaction | null> {
    const [row] = await this.db
      .select()
      .from(transactionsTable)
      .where(eq(transactionsTable.id, id));

    if (row) return mapRowToTransaction(row);

    return null;
  }
}
