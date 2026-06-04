import { Money } from '@/shared/money/money';
import { CreateTransactionSchema } from './create-transaction.dto';

describe('CreateTransactionSchema.safeParse', () => {
  it('should parse successfully', () => {
    const bodyToParse = {
      externalId: 'ext-usd-001',
      providerId: '01aab525-e6c4-4ef7-ac0c-a353ebdc1c61',
      amount: '150.50',
      currency: 'usd',
      type: 'payin',
      metadata: { note: 'test usd' },
    };

    const result = CreateTransactionSchema.safeParse(bodyToParse);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('expected success');
    expect(result.data.amount).toBeInstanceOf(Money);
    expect(result.data.amount.toDisplayString()).toEqual('150.50');
  });
  it('should fail parsing - wrong precision', () => {
    const bodyToParse = {
      externalId: 'ext-usd-001',
      providerId: '01aab525-e6c4-4ef7-ac0c-a353ebdc1c61',
      amount: '1.999',
      currency: 'usd',
      type: 'payin',
      metadata: { note: 'test usd' },
    };

    const result = CreateTransactionSchema.safeParse(bodyToParse);
    expect(result.success).toBe(false);
    expect(
      result.error?.issues.filter((issue) => issue.path.includes('amount'))
        .length,
    ).toBeGreaterThan(0);
  });
  it('should fail parsing - invalid amount - zero value', () => {
    const bodyToParse = {
      externalId: 'ext-usd-001',
      providerId: '01aab525-e6c4-4ef7-ac0c-a353ebdc1c61',
      amount: '0.00',
      currency: 'usd',
      type: 'payin',
      metadata: { note: 'test usd' },
    };

    const result = CreateTransactionSchema.safeParse(bodyToParse);
    expect(result.success).toBe(false);
    expect(
      result.error?.issues.filter((issue) => issue.path.includes('amount'))
        .length,
    ).toBeGreaterThan(0);
  });
  it('should fail parsing - invalid amount - non-numerical value', () => {
    const bodyToParse = {
      externalId: 'ext-usd-001',
      providerId: '01aab525-e6c4-4ef7-ac0c-a353ebdc1c61',
      amount: 'abc',
      currency: 'usd',
      type: 'payin',
      metadata: { note: 'test usd' },
    };

    const result = CreateTransactionSchema.safeParse(bodyToParse);
    expect(result.success).toBe(false);
  });
  it('should fail parsing - invalid amount - invalid currency', () => {
    const bodyToParse = {
      externalId: 'ext-usd-001',
      providerId: '01aab525-e6c4-4ef7-ac0c-a353ebdc1c61',
      amount: '10',
      currency: 'ars',
      type: 'payin',
      metadata: { note: 'test usd' },
    };

    const result = CreateTransactionSchema.safeParse(bodyToParse);
    expect(result.success).toBe(false);
    expect(
      result.error?.issues.filter((issue) => !!issue.path.includes('currency'))
        .length,
    ).toBeGreaterThan(0);
  });
});
