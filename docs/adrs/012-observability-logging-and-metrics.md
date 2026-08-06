# 012 — Observability for the MVP: structured logging (allowlist) + DB-derived counters

**Status:** Accepted
**Date:** 2026-06-25
**Authors:** Juan Di Modugno
**Tags:** observability, infra, security, mvp

## Context

El flujo de procesamiento es asíncrono y cruza un salto de proceso: el `POST /webhooks/:providerId` persiste el evento y devuelve `200` (200-post-save), y *después* un worker de BullMQ lo toma y lo procesa (o lo manda a `pending_manual_review` / `dead_letter_events`). Hoy ese flujo es una caja negra: si un evento falla, no hay forma de reconstruir su historia, ni de ver el estado agregado del sistema.

Para el **MVP demo** necesitamos dos capacidades mínimas: (1) poder reconstruir la traza de un evento a través del salto async, y (2) ver cuántos eventos hay en cada estado terminal (`processed` / `failed` / `dead-lettered`). Restricciones: es un MVP con **providers mockeados** (sin tráfico real), no queremos sumar infraestructura que no se pague todavía, y por ser fintech el payload del webhook contiene datos sensibles (montos, datos del pagador, signatures del provider) que no deben terminar en texto plano en un log.

Se distingue explícitamente **structured logging** (forensics pasivo: qué pasó, se lee después) de **monitoring + alerting** (activo: te despierta ante un desvío). Este ADR cubre solo lo primero; el segundo queda fuera de scope.

## Decision

Para el MVP vamos a implementar **structured logging con Pino** y **contadores derivados de la base de datos**, con estas reglas:

1. **Logging:** cada paso del flujo (recepción → enqueue → worker → resultado/DLQ) emite un log estructurado. La **clave de correlación primaria** es el `event.id` interno (globalmente único, ya viaja en el job a través del salto async, existe a partir del save). El `providerId` y el `externalEventId` viajan como campos adicionales para pivotear desde la vista del provider.
2. **Allowlist de campos:** nunca se loguea el payload crudo. Se construye explícitamente un objeto de log con **solo** los campos elegidos. Un campo nuevo en el payload no aparece en los logs salvo que se lo agregue a mano.
3. **Métricas:** los contadores `processed / failed / dead-lettered` se **derivan de la DB** (estado de `webhook_events` + `dead_letter_events`), reutilizando el patrón read-only de `GET /reconciliation-status`. No se introduce `/metrics` ni Prometheus.
4. **Alerting / monitoring activo:** fuera de scope (deferred).

## Alternatives Considered

### Eje logging — qué se loguea

#### Alternative A: Allowlist (elegida)
- **Cómo funciona:** se construye a mano el objeto de log con los campos explícitamente elegidos; el payload crudo nunca se loguea.
- **Pros:** fail-closed para datos sensibles (un campo nuevo no se filtra por defecto); logs flacos → menor costo a volumen (storage + ingest se cobran por GB).
- **Cons:** fail-open para *utilidad* — si olvidás incluir un campo útil (no sensible), perdés esa traza y te enterás recién al debuggear: las trazas tienen información limitada.
- **Por qué elegida:** la seguridad por construcción (decisiones voluntarias, no side-effects) pesa más que el riesgo de una traza incompleta, que es recuperable.

#### Alternative B: Denylist / redact (Pino `redact`)
- **Cómo funciona:** se loguea el objeto entero y se configuran los paths sensibles a enmascarar.
- **Pros:** menos boilerplate; el objeto completo queda disponible.
- **Cons:** **fail-open** — un campo sensible nuevo que no esté en la lista se filtra en texto plano. Depende de acordarse en cada cambio de payload.
- **Por qué no elegida:** en fintech, una fuga por olvido es inaceptable; el modo de falla seguro es el criterio rector.

#### Alternative C: Log-everything (sin política)
- **Pros:** cero esfuerzo.
- **Cons:** filtra todo lo sensible siempre + costo máximo a volumen.
- **Por qué no elegida:** descartada rápido, viola el requisito regulatorio.

### Eje métricas — de dónde sale el conteo

#### Alternative A: DB-derived counts (elegida)
- **Cómo funciona:** `SELECT status, count(*) ... GROUP BY status` + count del anexo, expuesto en la lente read-only existente.
- **Pros:** fuente de verdad (estado real del dominio), durable (sobrevive cualquier restart), cero infra nueva (reuso del patrón d10).
- **Cons:** es un snapshot puntual, no una tasa; no da throughput/latencia nativos.
- **Por qué elegida:** la DB ya *sabe* estos números; para el MVP el snapshot durable es lo que la demo necesita.

#### Alternative B: In-memory + `/metrics` (Prometheus)
- **Cómo funciona:** contadores en memoria expuestos en `/metrics`, scrapeados por Prometheus.
- **Pros:** datos operacionales nativos (hits, throughput, latencia), base para alertas configurables por desvíos.
- **Cons:** dependencia nueva (`prom-client` + Prometheus enfrente); el contador no es fuente de verdad y resetea en restart (aceptable en el modelo Prometheus, pero infra que no se paga con mocks).
- **Por qué no elegida:** suma estructura que no rinde sin tráfico real.

#### Alternative C: Log-derived (agregación downstream)
- **Cómo funciona:** los counts se calculan en el agregador de logs a partir de campos estructurados.
- **Cons:** depende de un agregador que no existe en el MVP; no es fuente de verdad.
- **Por qué no elegida:** misma razón que B, sin siquiera la ventaja operacional inmediata.

## Trade-off Matrix

| Criterio (logging) | Allowlist | Denylist | Log-everything |
|--------------------|-----------|----------|----------------|
| Falla con campo nuevo | fail-closed | fail-open | filtra siempre |
| Costo a volumen | mínimo | medio | alto |
| Esfuerzo | por campo | config paths | cero |

| Criterio (métricas) | DB-derived | In-memory+/metrics | Log-derived |
|---------------------|-----------|--------------------|-------------|
| Fuente de verdad | sí | no (aprox) | no |
| Infra nueva | cero | prom-client+Prom | agregador |
| Naturaleza | snapshot durable | tasa/throughput | tasa |

## Consequences

### Positive
- Un evento que falla se reconstruye grepeando un solo identificador (`event.id`) a través del salto async.
- Imposibilidad por construcción de filtrar un campo sensible nuevo (allowlist fail-closed).
- Logs flacos → costo de observability acotado a volumen.
- Conteos exactos y durables sin infraestructura nueva (reuso del patrón existente).

### Negative
- **Allowlist:** si se omite un campo útil (no sensible), las trazas quedan con información limitada hasta que se lo agregue; el costo de un olvido es una traza pobre, no una fuga.
- **DB-derived counts:** se renuncia a la data operacional nativa (throughput, latencia, alertas por desvío) que daría un `/metrics` Prometheus.
- Sin alerting activo: una falla se ve en forensics, no te despierta.

### Risks
- Allowlist demasiado agresivo → debugging ciego. Mitigación: revisar los campos logueados cuando un incidente real muestre que falta contexto.
- Conteo por query sobre tablas grandes → costo creciente. Mitigación: índices por `status`; revisitar si la tabla escala.
- **Deuda conocida (detectada 2026-07-30, d29): el `err` esquiva la allowlist.**
  `StructuredLogger.error`/`warn` spreadean `err` crudo en el payload de pino, fuera de
  `getLoggableFields`. La promesa *fail-closed* se cumple para la entidad y **no** para
  el error: un mensaje de driver que arrastre payload, fragmento de query o datos del
  cliente sale entero. Accepted con la deuda anotada en vez de quedar en `Proposed`: la
  decisión está tomada y en uso; lo que falta es cumplimiento, no definición. ADR-016
  amplía su alcance (más errores viajan al punto de decisión para ser logueados) sin
  introducirla. Cierre planificado: d30.
  → **Resuelta 2026-08-04, ver la enmienda siguiente.**

## Amendment (2026-08-04) — the allowlist promise extended to errors

### The hole, measured

The fail-closed promise could not hold for `err`, and the reason is structural: the
allowlist covers entities *we* construct, while `Error` objects are constructed by
`node-postgres`, Zod, or `fetch`. Pino's default `err` serializer copies the error's
own enumerable properties, so everything a driver attaches ships to the log stream.
Executed against `pino@8`:

```json
{ "type": "Error",
  "message": "duplicate key value violates unique constraint",
  "detail": "Key (external_id)=(evt_777) already exists.",
  "table": "webhook_events",
  "constraint": "webhook_events_external_id_uk",
  "code": "23505" }
```

`detail` carries the row value. The line that matters: `constraint` is an
**identifier** (tells you what broke), `detail` is a **value** (is the data).
Logging the first is observability; logging the second is the leak.

An allowlist over error *fields* was not obviously sufficient either, because a
third party can put the value inside `message`. That residual risk is accepted
explicitly below — it is not solved, it is bounded.

### Decision: allowlist at the sink (floor) + translation at the boundary (enrichment)

**Floor — a custom pino `err` serializer with a field allowlist.** Unknown error
fields are dropped by construction. This is what restores the fail-closed promise:
a repository added next month that forgets everything still cannot leak `detail`.

**Enrichment — repositories translate driver errors at the boundary.** The
repository is the only place holding both the driver error with all its fields and
the knowledge of which operation was running. It selects the safe context and
discards the rest:

```json
{ "type": "PersistenceError",
  "message": "dead_letter.append: duplicate key value violates unique constraint",
  "operation": "dead_letter.append",
  "constraint": "webhook_events_external_id_uk",
  "pgCode": "23505" }
```

Same anti-corruption move as ADR-016's `UnsupportedCurrencyError`: the edge that
touches the third party translates it into our vocabulary. Wrapping also drops the
cause's own properties (verified: pino does not copy them), so `detail` dies at the
boundary even before the serializer sees it — the two layers are independent.

### Why both, and not either alone

Translation alone is **fail-open**: miss one boundary and the leak returns silently.
A serializer alone is **fail-closed but blind** — it cannot supply `operation`, and
its safe-field list is a guess about every library, present and future.

### Relationship to ADR-016

ADR-016 states *infra does not log what it propagates*. That rule is unchanged:
**translating is not logging.** The repository emits no log line; it constructs an
error in its own vocabulary and propagates it. What this amendment adds is that
infra translates what it propagates.

### Accepted residual risk

The third party's `message` still ships (pino concatenates the cause's message).
The surface is reduced, not eliminated. Revisit if a driver is found to place row
values in `message` rather than in a dedicated field.

## When to Revisit

- **Post-MVP con tráfico y providers reales:** ahí la observabilidad operacional (throughput, latencia, alertas por desvío) pasa a ser una necesidad real → introducir `/metrics` + Prometheus y, probablemente, alerting activo. Con providers mockeados esa estructura no se paga.
- Si el costo de las queries de conteo se vuelve significativo al escalar el volumen de eventos.

## References

- ADR-007 (webhook idempotency — origen de `UNIQUE(providerId, externalEventId)`)
- ADR-011 (dead-letter annex table — fuente del count `dead-lettered`)
- `GET /reconciliation-status` (patrón read-only reutilizado para los counts)
- Pino `redact` / serializers (documentación a verificar en la implementación)
