import { Injectable } from '@nestjs/common';
import { TransactionsRepository } from './transactions.repository';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { Transaction } from './transaction.types';
import { TransactionNotFoundError } from './transactions.exception';

@Injectable()
export class TransactionsService {
  constructor(private repository: TransactionsRepository) {}

  async create(data: CreateTransactionDto): Promise<Transaction> {
    return this.repository.create({
      ...data,
      amount: data.amount.toDecimal(),
      status: 'pending',
    });
  }

  async findAll(): Promise<Transaction[]> {
    return this.repository.findAll();
  }

  async findById(id: string): Promise<Transaction> {
    const transaction = await this.repository.findById(id);

    if (!transaction) {
      throw new TransactionNotFoundError(id);
    }

    return transaction;
  }
}
