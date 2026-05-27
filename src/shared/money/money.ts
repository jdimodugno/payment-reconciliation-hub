/**
 * Money — Value Object for monetary amounts
 *
 * Why this exists (PRINCIPLE T1):
 *
 * JavaScript's `number` is IEEE 754 floating point. This produces well-known
 * bugs like `0.1 + 0.2 === 0.30000000000000004`. In financial systems where
 * we report to regulators (BCRA, equivalents), this is unacceptable.
 *
 * Strategy: store amounts as bigint cents (smallest unit of currency).
 * - USD $1.50 → 150n
 * - JPY ¥150 → 150n (no decimals in JPY)
 * - BTC 0.001 → 100000n (in satoshis)
 *
 * Each currency has a defined "scale" (decimal places). Money is created
 * via factory methods that validate scale and currency, never via raw constructor.
 *
 * INTENTIONALLY INCOMPLETE: this is a starting scaffold. You will:
 * 1. Decide currency representation (ISO 4217? custom?)
 * 2. Implement arithmetic operations (add, subtract, multiply by scalar)
 * 3. Implement comparison (equals, greaterThan, etc.)
 * 4. Add formatting for display
 * 5. Handle currency conversion (or explicitly refuse it)
 *
 * Write an ADR (`/assisted-adr money-representation`) BEFORE completing this.
 * Trade-offs to consider:
 * - bigint cents vs string decimal vs decimal library (decimal.js, big.js)
 * - Mutable vs immutable operations
 * - Currency mixing: explicit error vs implicit conversion vs forbidden
 */
export class Money {
  private constructor(
    private readonly cents: bigint,
    private readonly currency: string,
  ) {}

  /**
   * Factory: create Money from a decimal string.
   *
   * @example
   *   Money.fromDecimal('1.50', 'USD')
   *   Money.fromDecimal('100', 'JPY')
   *
   * IMPLEMENT: validation, scale lookup, conversion to cents.
   */
  static fromDecimal(_amount: string, _currency: string): Money {
    throw new Error('Not implemented — see CLAUDE.md, write ADR first');
  }

  /**
   * Factory: create Money directly from cents (smallest currency unit).
   *
   * @example
   *   Money.fromCents(150n, 'USD')  // $1.50
   */
  static fromCents(_cents: bigint, _currency: string): Money {
    throw new Error('Not implemented');
  }

  /**
   * Returns the amount as a decimal string for display.
   * NEVER returns a number — that would defeat the entire point.
   */
  toDecimal(): string {
    throw new Error('Not implemented');
  }

  /**
   * Returns raw cents. Useful for serialization to/from database.
   */
  toCents(): bigint {
    return this.cents;
  }

  getCurrency(): string {
    return this.currency;
  }
}
