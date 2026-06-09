# 009 — Provider Event to Domain Transaction Mapping

**Status:** Accepted
**Date:** 2026-06-09
**Authors:** Juan Di Modugno
**Tags:** domain, anti-corruption, mapping, type-safety

## Context

Al procesar un webhook, el `EnrichedProviderEvent` (que cada provider ya normaliza
desde su payload crudo a un `ProviderEventType` canónico: `payment.succeeded` /
`payment.failed` / `payment.refunded`) debe convertirse en una `Transaction` del dominio,
con `type: 'payin' | 'payout'` y `status: 'pending' | 'settled' | 'failed' | 'reversed'`.

Hoy esa conversión está **hardcodeada** (`type: 'payout'`, `status: 'settled'`), lo que
rompe en cuanto entra el segundo tipo de evento. Faltan dos cosas:

1. Un **mapeo tipado** `ProviderEventType → transaction.status` (succeeded→settled,
   failed→failed, refunded→reversed).
2. La **dirección** (`payin`/`payout`) de la Transaction.

**Nota sobre la dirección (amendment, 2026-06-09):** la versión inicial de este ADR asumía
que la dirección era un campo que cada provider poblaba en `EnrichedProviderEvent`. Al
implementar se verificó que **ningún payload (Stripe ni MercadoPago) modela dirección** —
porque la dirección NO se deriva del event-type: es ortogonal. Los `ProviderEventType`
actuales (`payment.succeeded`/`failed`/`refunded`) modelan el **ciclo de vida de un pago**,
y todo evento de tipo `payment.*` es **payin por naturaleza**. Un payout es otro recurso
con sus propios event-types (`payout.*`) que **no se modelan todavía**. Por lo tanto la
dirección **se deriva del event-type-family**, no de un campo inventado sin fuente de datos
(evita superficie que miente, mismo criterio con el que se limpió el enum de status).

Restricción clave: el procesamiento es un **anti-corruption boundary** — recibe data de
sistemas externos que no controlamos. Un event-type desconocido (un tipo nuevo del
provider, o data corrupta) NO debe crashear el sistema: debe parkearse para revisión
humana (no-retriable). Decisión reversible (lógica interna).

## Decision

**Diseño en dos capas, cada mapeo en su dueño:**

- **Provider (anti-corruption, específico):** raw payload → `ProviderEventType` canónico
  + amount + currency. La asimetría entre providers (Stripe usa `type`, MercadoPago usa
  `action`) vive acá y solo acá. **No** se agrega campo de dirección (los payloads no la
  modelan).
- **Dominio (agnóstico):** mapeo `ProviderEventType → (transaction.status, transaction.type)`,
  igual para todos los providers. El `status` sale del event-type (succeeded→settled, etc.);
  la **dirección** se deriva del event-type-family: hoy todo `payment.*` → `payin`. Cuando
  se agreguen event-types de payout (`payout.*`), nace la rama `payout`.

**El mapeo de status se implementa como `Record` exhaustivo + guard de runtime
(alternativa C):**

- Un `Record<ProviderEventType, TransactionStatus>` da **exhaustividad en compile-time**:
  agregar un `ProviderEventType` nuevo no compila hasta mapearlo.
- La función de mapeo recibe el valor crudo (`string`), verifica que sea una key válida del
  Record, y devuelve el `TransactionStatus` o `null`.
- `null` → el service transiciona el evento a `pending_manual_review` con reason
  `UNSUPPORTED_EVENT_TYPE` (nuevo `PendingManualReviewReason`), sin incrementar retries
  (es no-retriable, igual que `unsupported_currency`).

## Alternatives Considered

### Alternative A: `Record<ProviderEventType, TransactionStatus>` solo
- **Cómo funciona:** objeto literal tipado por el union como key.
- **Pros:** exhaustividad compile-time.
- **Cons:** sin fallback para valores fuera del union (corrupción / type desconocido) →
  asume que nunca pasan, o crashea.
- **Por qué no elegida:** no respeta el requisito de anti-corruption (parkear lo
  desconocido en runtime).

### Alternative B: `switch` con `default → null`
- **Cómo funciona:** switch por caso; default devuelve null → manual review.
- **Pros:** tolerancia runtime (parkea cualquier valor desconocido).
- **Cons:** pierde exhaustividad — el `default` se traga todo; un `ProviderEventType` nuevo
  no fuerza handleo, se va silencioso a review.
- **Por qué no elegida:** sacrifica la garantía compile-time de que cada type conocido se
  maneja explícitamente.

### Alternative C: `Record` exhaustivo + guard de runtime (elegida)
- **Cómo funciona:** ver Decision.
- **Pros:** ambas garantías — compile-time fuerza mapear todo type conocido; runtime parkea
  valores fuera del union.
- **Cons:** algo más de boilerplate y complejidad (el Record + el guard de pertenencia) que
  A o B por separado.

## Consequences

### Positive
- Agregar un `ProviderEventType` nuevo rompe el build hasta mapearlo (no se olvida).
- Un event-type desconocido en runtime se parkea (manual review), no crashea.
- La asimetría entre providers queda contenida en cada provider; el dominio no la conoce (T3).
- Elimina el hardcode `type`/`status`.

### Negative
- Más código que un mapeo naive (Record + guard + reason nuevo).
- La dirección queda acoplada al event-type-family hasta que se modelen los payout events;
  agregar payout requiere nuevos `ProviderEventType` + extender el mapeo de dirección.

### Risks
- **Riesgo:** confundir el event-type (provider) con el transaction-status (dominio).
  **Mitigación:** el ADR documenta que son dos vocabularios distintos en dos capas.
- **Riesgo:** asumir que `payment.*` siempre es payin si en el futuro un provider mete
  semántica de payout dentro de un `payment.*`. **Mitigación:** modelar payout con sus
  propios event-types, no sobrecargar los de payment.

## When to Revisit

- Si el mapeo `event → status` deja de ser 1:1 (ej. un mismo event-type mapea a distintos
  status según contexto) → el Record ya no alcanza, se necesita lógica.
- Si la dirección no se puede derivar del payload de algún provider futuro → reconsiderar
  el contrato.
- Si aparece un provider cuyo set de eventos no encaja en `ProviderEventType` → revisar la
  capa de normalización.

## References

- ADR-008 — Webhook Processing Idempotency (este mapeo corre dentro de ese flujo).
- Día 7 (learning): clasificación asimétrica por provider (Stripe `type` / MP `action`).
- `EnrichedProviderEvent` (`provider-event.type.ts`); `transactionStatusEnum`,
  `transactionTypeEnum` (`transaction.schema.ts`).
