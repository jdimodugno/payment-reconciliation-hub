import { isValidCurrency } from './currency';

describe('Currencies.isValidCurrency', () => {
  it('should return true given usd - enum value', () => {
    expect(isValidCurrency('usd')).toEqual(true);
  });
  it('should return false given USD - enum key', () => {
    expect(isValidCurrency('USD')).toEqual(false);
  });
  it('should return false given xyz', () => {
    expect(isValidCurrency('xyz')).toEqual(false);
  });
});
