import z from 'zod';
import { transactionTypeEnum } from '../transaction.schema';
import { Money } from '@/shared/money/money';
import { Currencies, CURRENCY_DECIMALS } from '@/shared/money/currency';
import Decimal from 'decimal.js';

const DECIMAL_RE = /^\d+(\.\d+)?$/;

export const CreateTransactionSchema = z
  .object({
    externalId: z.string(),
    providerId: z.uuid(),
    amount: z.string().regex(DECIMAL_RE, {
      error: 'amount must be a valid decimal string',
    }),
    currency: z.enum(Currencies),
    type: z.enum(transactionTypeEnum.enumValues),
    metadata: z.record(z.string(), z.unknown()).nullable(),
  })
  .superRefine((raw, ctx) => {
    if (!DECIMAL_RE.test(raw.amount)) return;
    const maxDecimals = CURRENCY_DECIMALS[raw.currency];
    const [_, decimalPart] = raw.amount.split('.');
    const decimals = decimalPart?.length ?? 0;
    if (decimals > maxDecimals) {
      ctx.addIssue({
        code: 'custom',
        path: ['amount'],
        message: `${raw.currency} allows at most ${maxDecimals}`,
      });
    }
    if (new Decimal(raw.amount).isZero()) {
      ctx.addIssue({
        code: 'custom',
        path: ['amount'],
        message: `Amount must be greater than 0`,
      });
    }
  })
  .transform((raw) => ({
    ...raw,
    amount: Money.fromDecimal(raw.amount, raw.currency),
  }));

export type CreateTransactionDto = z.infer<typeof CreateTransactionSchema>;

export type CreateTransactionData = Omit<CreateTransactionDto, 'amount'> & {
  amount: string;
  status: 'pending';
};
