import { Controller, Post, HttpCode, HttpStatus, Body } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { TransactionsService } from './transactions.service';
import {
  CreateTransactionDto,
  CreateTransactionSchema,
} from './dto/create-transaction.dto';
import { ZodValidationPipe } from '@/shared/pipes/zod-validation.pipe';

@ApiTags('transactions')
@Controller('transactions')
export class TransactionsController {
  constructor(private transactionService: TransactionsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ZodValidationPipe(CreateTransactionSchema))
    requestBody: CreateTransactionDto,
  ) {
    const transaction = await this.transactionService.create(requestBody);
    return {
      ...transaction,
      amount: transaction.amount.toDisplayString(),
    };
  }
}
