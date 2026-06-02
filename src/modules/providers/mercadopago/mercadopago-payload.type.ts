// {
//  "id": 12345,
//  "type": "payment",
//  "action": "payment.created",
//  "data": {
//    "id": "999999999"
//  }
// }

export type RawMercadoPagoEventType = 'payment';
export type RawMercadoPagoEventAction = 'payment.created' | 'payment.updated';

export type MercadoPagoPayload = {
  id: number;
  type: RawMercadoPagoEventType;
  action: RawMercadoPagoEventAction;
  data: {
    id: string;
  };
};
