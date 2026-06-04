import { Injectable } from '@nestjs/common';
import { TransactionsRepository } from './transactions.repository';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { Transaction } from './transaction.types';

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
}
