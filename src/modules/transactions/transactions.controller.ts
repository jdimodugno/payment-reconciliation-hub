import {
  Controller,
  Post,
  HttpCode,
  HttpStatus,
  Body,
  UseFilters,
  Param,
  Get,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { TransactionsService } from './transactions.service';
import {
  CreateTransactionDto,
  CreateTransactionSchema,
} from './dto/create-transaction.dto';
import { ZodValidationPipe } from '@/shared/pipes/zod-validation.pipe';
import { EntityNotFoundExceptionFilter } from '@/shared/filter/entity-not-found-exception.filter';

@ApiTags('transactions')
@Controller('transactions')
@UseFilters(EntityNotFoundExceptionFilter)
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

  @Get('/:id')
  @HttpCode(HttpStatus.OK)
  async findById(@Param('id') id: string) {
    const transaction = await this.transactionService.findById(id);
    return {
      ...transaction,
      amount: transaction.amount.toDisplayString(),
    };
  }
}
