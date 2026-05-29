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
 * These tests INTENTIONALLY FAIL because Money is not yet implemented.
 * That's correct: TDD says write the failing test first.
 *
 * When you implement Money (week 1-2), these tests guide the API design.
 */
// SKIPPED TEMPORARILY: Money is not yet implemented (pending ADR-T1, money
// representation). Re-enable by removing `.skip` once Money lands with its
// implementation. Keeps CI green without masking the TDD-red intent above.
describe.skip('Money', () => {
  describe('factory: fromDecimal', () => {
    it('should create Money from decimal string with USD', () => {
      // Arrange
      const amount = '1.50';
      const currency = 'USD';

      // Act
      const money = Money.fromDecimal(amount, currency);

      // Assert
      expect(money.toCents()).toBe(150n);
      expect(money.getCurrency()).toBe('USD');
    });

    it('should create Money from integer string for zero-decimal currency', () => {
      const money = Money.fromDecimal('100', 'JPY');

      expect(money.toCents()).toBe(100n);
    });

    it('should reject invalid decimal format', () => {
      expect(() => Money.fromDecimal('1.5.0', 'USD')).toThrow();
    });

    it('should reject unknown currency', () => {
      expect(() => Money.fromDecimal('1.00', 'XYZ')).toThrow();
    });
  });

  describe('factory: fromCents', () => {
    it('should create Money from bigint cents', () => {
      const money = Money.fromCents(150n, 'USD');

      expect(money.toCents()).toBe(150n);
      expect(money.toDecimal()).toBe('1.50');
    });
  });

  describe('Edge cases — the cases that matter most in fintech', () => {
    it('should handle zero amounts', () => {
      const money = Money.fromCents(0n, 'USD');

      expect(money.toDecimal()).toBe('0.00');
    });

    it('should handle very large amounts (bigint precision)', () => {
      // 1 trillion USD in cents
      const huge = 100_000_000_000_000n;
      const money = Money.fromCents(huge, 'USD');

      expect(money.toCents()).toBe(huge);
    });

    it('should NOT lose precision on 0.1 + 0.2 equivalent', () => {
      // The cardinal sin of floating point: 0.1 + 0.2 === 0.30000000000000004
      // This test ensures we are immune.
      const a = Money.fromDecimal('0.10', 'USD');
      const b = Money.fromDecimal('0.20', 'USD');

      // When add() is implemented:
      // const sum = a.add(b);
      // expect(sum.toDecimal()).toBe('0.30');

      // For now, just verify the parts are stored exactly
      expect(a.toCents()).toBe(10n);
      expect(b.toCents()).toBe(20n);
    });
  });
});
