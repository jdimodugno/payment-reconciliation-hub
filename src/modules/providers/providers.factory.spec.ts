import { isValidProvider } from './providers.factory';

describe('isValidProvider', () => {
  it("'stripe' → true", () => {
    expect(isValidProvider('stripe')).toBe(true);
  });
  it("'mercadopago' → true", () => {
    expect(isValidProvider('mercadopago')).toBe(true);
  });
  it("'banco_inventado' (desconocido) → false", () => {
    expect(isValidProvider('banco_inventado')).toBe(false);
  });
  it("'toString' → false (no es un provider, es prop de Object.prototype)", () => {
    expect(isValidProvider('toString')).toBe(false);
  });
});
