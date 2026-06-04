import { Money } from './money';

/**
 * Reference test file showing the expected testing pattern for this project.
 *
 * Conventions:
 * - AAA pattern: Arrange, Act, Assert
 * - Descriptive test names: "should X when Y given Z"
 * - One assertion per test (when reasonable)
 * - Test the public API, not internals
 * - Edge cases are first-class citizens (see "Edge cases" describe block)
 *
 * NOTE (ADR-005): the original version of this spec targeted a bigint-cents
 * API (fromCents/fromDecimal/toCents). ADR-005 superseded that hypothesis:
 * Money is now backed by decimal.js and constructed from minor units, with
 * per-currency scale resolved internally. The tests below reflect that API.
 * Arithmetic/comparison helpers (add, equals, ...) are pending and will land
 * with their own tests when the domain needs them.
 */
describe('Money', () => {
  describe('factory: fromMinorUnits', () => {
    it('should convert USD minor units (2 decimals) to a decimal string', () => {
      const money = Money.fromMinorUnits(2000, 'usd');

      expect(money.toDecimal()).toBe('20');
      expect(money.getCurrency()).toBe('usd');
    });

    it('should treat zero-decimal currencies (JPY) without scaling', () => {
      const money = Money.fromMinorUnits(150, 'jpy');

      expect(money.toDecimal()).toBe('150');
    });

    it('should convert 8-decimal currencies (BTC) from satoshis', () => {
      // 100_000_000 satoshis = 1 BTC
      const money = Money.fromMinorUnits(100_000_000, 'btc');

      expect(money.toDecimal()).toBe('1');
    });

    it('should reject a non-integer minor-unit value', () => {
      expect(() => Money.fromMinorUnits(1.5, 'usd')).toThrow();
    });

    it('should reject an unknown currency', () => {
      expect(() => Money.fromMinorUnits(100, 'xyz')).toThrow();
    });
  });
  describe('factory: fromDecimal', () => {
    it('should convert USD decimal number to a decimal string', () => {
      const money = Money.fromDecimal('200.21', 'usd');

      expect(money.toDecimal()).toBe('200.21');
      expect(money.getCurrency()).toBe('usd');
    });

    it('should reject an unknown currency', () => {
      expect(() => Money.fromDecimal('100', 'xyz')).toThrow();
    });
  });
  describe('generic: toDisplayString', () => {
    it('should format Money to display string - usd', () => {
      const displayString = Money.fromDecimal('200', 'usd').toDisplayString();
      expect(displayString).toBe('200.00');
    });
    it('should format Money to display string - jpy', () => {
      const displayString = Money.fromDecimal('1000', 'jpy').toDisplayString();
      expect(displayString).toBe('1000');
    });
    it('should format Money to display string - btc', () => {
      const displayString = Money.fromDecimal(
        '0.0001',
        'btc',
      ).toDisplayString();
      expect(displayString).toBe('0.00010000');
    });
  });

  describe('Edge cases — the cases that matter most in fintech', () => {
    it('should handle zero amounts', () => {
      const money = Money.fromMinorUnits(0, 'usd');

      expect(money.toDecimal()).toBe('0');
    });

    it('should handle very large amounts without precision loss', () => {
      // 1 trillion USD expressed in cents
      const oneTrillionInCents = 100_000_000_000_000;
      const money = Money.fromMinorUnits(oneTrillionInCents, 'usd');

      expect(money.toDecimal()).toBe('1000000000000');
    });

    it('should NOT lose precision the way IEEE-754 floats do', () => {
      // The cardinal sin of floating point: 0.1 + 0.2 === 0.30000000000000004.
      // decimal.js keeps these exact. Once add() lands, assert the sum is '0.3';
      // for now, prove each part is stored/rendered exactly.
      const tenCents = Money.fromMinorUnits(10, 'usd');
      const twentyCents = Money.fromMinorUnits(20, 'usd');

      expect(tenCents.toDecimal()).toBe('0.1');
      expect(twentyCents.toDecimal()).toBe('0.2');
    });
  });
});
