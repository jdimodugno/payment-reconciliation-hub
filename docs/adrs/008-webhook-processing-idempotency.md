# 008 — Webhook Processing Idempotency

**Status:** Accepted
**Date:** 2026-06-08
**Authors:** Juan Di Modugno
**Tags:** domain, idempotency, concurrency, reliability

## Context

ADR-007 resolvió la idempotencia de **recepción**: un webhook entrante produce
exactamente una fila en `webhook_events`, vía `UNIQUE(providerId, externalEventId)`.
Eso garantiza que el evento se *guarda* una sola vez, pero no dice nada sobre su
*procesamiento*.

El procesamiento toma un evento recibido y crea/actualiza una `Transaction`.
Esto implica **dos escrituras**: (a) la Transaction y (b) la marca de que el evento
fue procesado (el link `webhook_events.transaction_id`). Si esas escrituras no son
atómicas, un fallo entre ambas —o un reintento del worker, o un redelivery del
provider— produce una **doble Transaction** para el mismo pago: double-credit /
double-spend, inaceptable en fintech.

Restricciones: hoy el procesamiento es **DB-only** (toca 2 filas del mismo Postgres),
no hay side-effects externos todavía, y se prioriza reusar infra existente (cero
componentes nuevos).

## Decision

Procesar dentro de una **única transacción de DB** que envuelve el **claim atómico
del evento** y el create/update de la Transaction:

1. `UPDATE webhook_events SET transaction_id = ... WHERE id = ? AND transaction_id IS NULL`
   — claim condicional: solo un worker gana la fila (el predicate `IS NULL` es a la vez
   guard de concurrencia vía row-lock y guard de idempotencia a través del tiempo).
2. Create/update de la `Transaction` en la misma transacción.
3. `COMMIT` → ambos persisten o ninguno. Si algo falla → `ROLLBACK` → el evento vuelve
   a ser procesable (`transaction_id` queda NULL).

El **árbitro de idempotencia es el claim**, no un constraint sobre `transactions`.

El conteo de reintentos (`retries--`) y la marca de dead-letter
(`pending_manual_review` al agotar N) viven **fuera** de la transacción que rollbackea
—si vivieran dentro, revertirían junto con el trabajo y el contador nunca decrementaría,
dejando el evento eternamente reprocesable.

## Alternatives Considered

### Alternative A: UNIQUE constraint en `transactions`
- **Cómo funciona:** `UNIQUE(providerId, externalEventId)` en transactions; INSERT +
  catch del 23505 (espejo de ADR-007).
- **Pros:** patrón ya conocido; árbitro fuerte a nivel índice.
- **Cons:** protege solo *esa* fila; no da atomicidad sobre el update del evento ni sobre
  futuras filas; no modela reintentos.
- **Por qué no elegida:** el procesamiento toca 2 filas → un constraint de una tabla no
  garantiza la atomicidad del conjunto. Se reserva como posible señal de observabilidad
  (detectar la violación = alerta), no como árbitro.

### Alternative B: Claim atómico + transacción de DB (elegida)
- **Cómo funciona:** ver Decision.
- **Pros:** atomicidad real sobre las 2 filas; el claim condicional serializa workers
  concurrentes; rollback deja el evento retriable; modela reintentos y dead-letter;
  cero infra nueva.
- **Cons:** garantía limitada al borde transaccional del DB (no cubre side-effects
  externos); más orquestación que ADR-007.

### Alternative C: Outbox / saga
- **Cómo funciona:** escribir la intención en la misma txn que el cambio de estado; un
  relay aparte ejecuta el efecto; el downstream dedupea con su idempotency key.
- **Pros:** única opción que cubre side-effects fuera del DB (mail, llamada al provider)
  con exactly-once effective.
- **Cons:** infra nueva (relay/cola), eventual consistency, complejidad operacional.
- **Por qué no elegida:** overkill hoy — el procesamiento es DB-only. Es el camino de
  migración cuando aparezca el primer side-effect externo.

## Consequences

### Positive
- Una Transaction por evento, garantizada bajo redelivery y reintentos concurrentes.
- Fallo de procesamiento = retriable automáticamente (rollback libera el claim).
- Eventos irrecuperables se aíslan en `pending_manual_review` en vez de loopear.
- Cero infra nueva; reusa Postgres y el modelo existente.

### Negative
- La garantía no se extiende a side-effects fuera del DB.
- Más lógica de orquestación (claim + retries fuera de txn) que el patrón de recepción.

### Risks
- **Riesgo:** poner `retries--` dentro de la txn → contador nunca decrementa.
  **Mitigación:** escritura del contador fuera del boundary transaccional, en el catch.
- **Riesgo:** orden incorrecto (marcar procesado antes de que el write tenga éxito) →
  evento perdido en silencio. **Mitigación:** el claim y el trabajo viven en la misma txn;
  solo el COMMIT consolida.

## When to Revisit

- Cuando el procesamiento deba disparar un **side-effect externo** (notificación, llamada
  al provider) → migrar a Outbox (C).
- Si el invariante de "una Transaction por pago" debe cruzar **más de una tabla/servicio**
  → reconsiderar árbitro y boundary.
- Si el volumen hace que el row-lock del claim sea un cuello de botella.

## References

- ADR-007 — Webhook Idempotency (recepción); este ADR es su espejo del lado de procesamiento.
- Día 7 (system design): exactly-once delivery es mito → at-least-once + idempotent
  consumer = effectively-once; atómico ≠ idempotente (ortogonales).
- Two Generals Problem; Inbox/Outbox patterns.
