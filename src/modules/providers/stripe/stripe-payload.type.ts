// {
//   "id": "evt_1Pj...",            // ← el evento → tu externalEventId
//   "object": "event",
//   "type": "payment_intent.succeeded",   // ← top-level → mapeás a ProviderEventType
//   "data": {
//     "object": {                   // ← el recurso (PaymentIntent)
//       "id": "pi_3N...",          // ← la transacción → tu externalId
//       "amount": 2000,            // ⚠️  INTEGER en la unidad mínima (centavos)
//       "currency": "usd",
//       "status": "succeeded"
//     }
//   }
// }

export type RawStripeEventType =
  | 'payment_intent.succeeded'
  | 'payment_intent.failed'
  | 'payment_intent.refunded';

export type StripeRawPayload = {
  id: string;
  object: string;
  type: RawStripeEventType;
  data: {
    object: {
      id: string;
      amount: number;
      currency: string;
    };
  };
};
