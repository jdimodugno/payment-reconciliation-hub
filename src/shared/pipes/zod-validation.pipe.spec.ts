import { CreateTransactionSchema } from '@/modules/transactions/dto/create-transaction.dto';
import { ZodValidationPipe } from './zod-validation.pipe';
import { Money } from '../money/money';
import { BadRequestException } from '@nestjs/common';

describe('ZodValidationPipe', () => {
  it('should validate successfully and return parsed entity', () => {
    const bodyToParse = {
      externalId: 'ext-usd-001',
      providerId: '01aab525-e6c4-4ef7-ac0c-a353ebdc1c61',
      amount: '150.50',
      currency: 'usd',
      type: 'payin',
      metadata: { note: 'test usd' },
    };
    const result = new ZodValidationPipe(CreateTransactionSchema).transform(
      bodyToParse,
      { type: 'body' },
    );

    expect(result.amount).toBeInstanceOf(Money);
  });
  it('should fail parsing and must throw and exception', () => {
    const bodyToParse = {
      externalId: 'ext-usd-001',
      providerId: '01aab525-e6c4-4ef7-ac0c-a353ebdc1c61',
      amount: '000.00',
      currency: 'usd',
      type: 'payin',
      metadata: { note: 'test usd' },
    };

    expect(() => {
      new ZodValidationPipe(CreateTransactionSchema).transform(bodyToParse, {
        type: 'body',
      });
    }).toThrow(BadRequestException);
  });
});
