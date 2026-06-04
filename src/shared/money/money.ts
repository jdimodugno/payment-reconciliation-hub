import Decimal from 'decimal.js';
import { Currencies, CURRENCY_DECIMALS, isValidCurrency } from './currency';
export class Money {
  private constructor(
    private readonly amount: Decimal, // ← era cents: bigint
    private readonly currency: Currencies,
  ) {}

  static fromMinorUnits(value: number, currency: string): Money {
    if (!isValidCurrency(currency))
      throw new Error(`Unknown currency: ${currency}`);

    const decimals = CURRENCY_DECIMALS[currency];
    if (!Number.isInteger(value))
      throw new Error('minor units must be an integer');
    if (!isValidCurrency(currency))
      throw new Error(`Unknown currency scale: ${currency}`);

    const amount = new Decimal(value).div(10 ** decimals);
    return new Money(amount, currency);
  }

  static fromDecimal(value: string, currency: string): Money {
    if (!isValidCurrency(currency))
      throw new Error(`Unknown currency: ${currency}`);
    return new Money(new Decimal(value), currency);
  }

  toDecimal(): string {
    return this.amount.toString();
  }

  toDisplayString(): string {
    return this.amount.toFixed(CURRENCY_DECIMALS[this.currency]);
  }

  getCurrency(): string {
    return this.currency;
  }
}
