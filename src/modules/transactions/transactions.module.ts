import { Module } from '@nestjs/common';
// import { TransactionsController } from './transactions.controller';
// import { TransactionsService } from './transactions.service';

/**
 * TransactionsModule
 *
 * Manages internal transaction records. Provides CRUD and domain operations
 * for transactions independent of external provider events.
 *
 * To implement (semana 1):
 * - Transaction entity (with Money value object — see PRINCIPLE T1)
 * - TransactionsRepository (abstracts persistence)
 * - TransactionsService (domain logic)
 * - TransactionsController (HTTP layer — thin)
 */
@Module({
  // controllers: [TransactionsController],
  // providers: [TransactionsService],
  // exports: [TransactionsService],
})
export class TransactionsModule {}
