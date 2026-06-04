import { isEnumValue } from '../enum/enum';

export enum Currencies {
  USD = 'usd',
  EUR = 'eur',
  JPY = 'jpy',
  BTC = 'btc',
}

export const CURRENCY_DECIMALS: Record<Currencies, number> = {
  [Currencies.USD]: 2,
  [Currencies.EUR]: 2,
  [Currencies.JPY]: 0,
  [Currencies.BTC]: 8,
};

export const isValidCurrency = (candidate: string): candidate is Currencies => {
  return isEnumValue(Currencies, candidate);
};
