import { NotFoundInExternalSourceError } from '@/shared/exception/not-found-external-source.exception';

// Stand-in for the real `GET /v1/payments/{id}` call. Extracted from the
// provider so it is a module seam: the provider's own behaviour towards a
// hostile response (unknown currency, missing payment) can be exercised by
// replacing this module, which is exactly what the network boundary will be.
export type MercadoPagoTxDetail = {
  id: string;
  amount: number;
  currency: string;
  status: string;
};

export const MOCK_NOT_FOUND_ID = 'mp_notfound_123';

export const fetchMercadoPagoTxDetail = async (
  txId: string,
): Promise<MercadoPagoTxDetail> => {
  if (!txId) throw new Error('Id is required for tx detail fetching');
  if (txId === MOCK_NOT_FOUND_ID) {
    throw new NotFoundInExternalSourceError(txId, 'MERCADO_PAGO');
  }

  return {
    id: '99999999',
    amount: 123,
    currency: 'usd',
    status: 'success',
  };
};
