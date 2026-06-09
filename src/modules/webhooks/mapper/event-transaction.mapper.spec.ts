import { mapEventToTransaction } from './event-transaction.mapper';

describe('mapEventToTransaction', () => {
  describe('event-types conocidos → mapping de dominio', () => {
    it('payment.succeeded → { status: settled, type: payin }', () => {
      const result = mapEventToTransaction('payment.succeeded');
      expect(result).not.toBeNull();
      if (!result) throw new Error('expected result');
      expect(result.status).toBe('settled');
      expect(result.type).toBe('payin');
    });
    it('payment.failed → { status: failed, type: payin }', () => {
      const result = mapEventToTransaction('payment.failed');
      expect(result).not.toBeNull();
      if (!result) throw new Error('expected result');
      expect(result.status).toBe('failed');
      expect(result.type).toBe('payin');
    });
    it('payment.refunded → { status: reversed, type: payin }', () => {
      const result = mapEventToTransaction('payment.refunded');
      expect(result).not.toBeNull();
      if (!result) throw new Error('expected result');
      expect(result.status).toBe('reversed');
      expect(result.type).toBe('payin');
    });
  });

  describe('valores no mapeables → null (anti-corruption)', () => {
    it('un event-type desconocido → null', () => {
      const result = mapEventToTransaction('payment.disputed');
      expect(result).toBeNull();
    });
    it("'toString' (prop heredada de Object.prototype) → null, no un mapping basura", () => {
      const result = mapEventToTransaction('toString');
      expect(result).toBeNull();
    });
  });
});
