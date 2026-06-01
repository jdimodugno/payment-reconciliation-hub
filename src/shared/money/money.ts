import Decimal from 'decimal.js';
import { CURRENCY_DECIMALS } from './currency';

export class Money {
  private constructor(
    private readonly amount: Decimal, // ← era cents: bigint
    private readonly currency: string,
  ) {}

  static fromMinorUnits(value: number, currency: string): Money {
    const decimals = CURRENCY_DECIMALS[currency.toLocaleLowerCase()];
    if (!Number.isInteger(value))
      throw new Error('minor units must be an integer');
    if (decimals === undefined)
      throw new Error(`Unknown currency scale: ${currency}`);

    const amount = new Decimal(value).div(10 ** decimals);
    return new Money(amount, currency);
  }

  toDecimal(): string {
    return this.amount.toString();
  }

  getCurrency(): string {
    return this.currency;
  }
}
