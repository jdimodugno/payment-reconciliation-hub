# 010 — Retry & Dead-Letter Strategy (Domain-Owned)

**Status:** Accepted
**Date:** 2026-06-12
**Authors:** Juan Di Modugno
**Tags:** domain, reliability, async, queue, dead-letter

## Context

ADR-008 dejó el procesamiento de webhooks idempotente y **sincrónico**: el árbitro es
el claim atómico, y el dominio ya cuenta `retries` con corte en `EVENT_MAX_PROCESSING_RETRIES`
hacia `pending_manual_review` (dead-letter). Semana 3 introduce **BullMQ**: la recepción
encola y un worker procesa async.

BullMQ trae su **propio** mecanismo de reintentos (attempts + backoff exponencial). Eso
crea una pregunta de diseño: al haber dos mecanismos de retry (el nativo de la cola y el
de dominio), **¿quién es el árbitro del agotamiento?** Si ambos cuentan el mismo fallo,
se duplica el árbitro (un mismo DB blip subiría el `attempts` de BullMQ *y* el `retries`
de la DB).

Restricciones y fuerzas:
- El endpoint **no bloquea el 200 esperando el enqueue** (200-post-save). El encolado es
  best-effort → **siempre puede haber mensajes que se persisten pero nunca se encolan**
  (enqueue falló, cola degradada, producer crashea entre save y enqueue).
- El dead-letter es una **decisión de negocio** (cuántos reintentos antes de que un humano
  mire), no una decisión de transporte.
- Las clases de fallo son distintas: **transitorias** (`UnableToPersistTransactionError`,
  reintentar ayuda) vs **determinísticas** (`InvariantViolationError`, unsupported
  currency/event-type — reintentar es inútil).

## Decision

**El dominio ownea el retry y el dead-letter; BullMQ NO reintenta.** El worker se
configura con `attempts: 1` (sin retry nativo). El reproceso de fallos transitorios lo
provee el **job de barrido** (`processPendingEvents` sobre `processed_at IS NULL`), que ya
existe como red de seguridad.

Reparto de responsabilidades:
- **BullMQ:** transporte y disparo del procesamiento de mensajes *conocidos*. Un solo
  intento; si falla, el evento queda `processed_at IS NULL` y será re-tomado por el barrido.
- **Barrido:** rescata las dos clases que la cola no puede cubrir — (a) **mensajes perdidos**
  (nunca se encolaron) y (b) **fallos transitorios** (vuelven a quedar pendientes). Corre
  sobre snapshot, por lo que puede pisarse con la cola → el **claim atómico (ADR-008) es el
  árbitro** que hace segura esa carrera (uno gana, el otro recibe `already_processed`).
- **Dominio:** `retries++` en fallo + corte en `EVENT_MAX_PROCESSING_RETRIES` → `pending_manual_review`.
  Único contador de reintentos = **un solo árbitro**, el problema del doble conteo desaparece
  por diseño.
- **Determinísticos:** no entran al ciclo de retry — unsupported → manual review;
  invariante → fail-fast (rethrow sin `retries++`).

Configuración: `EVENT_MAX_PROCESSING_RETRIES` es **regla de dominio versionada** (idéntica en todos
los envs). No se delega a config por-entorno de la cola.

## Alternatives Considered

### Alternative A: BullMQ owns everything
- **Cómo funciona:** retries nativos + DLQ de BullMQ; se elimina el `retries` de dominio y el barrido.
- **Pros:** menos piezas; backoff inmediato para transitorios.
- **Cons:** la cola **no conoce** los mensajes perdidos (enqueue fallido) → no los rescata;
  acopla la política de dead-letter (negocio) al transporte.
- **Por qué no elegida:** no cubre mensajes perdidos y mete la decisión de negocio dentro de la infra.

### Alternative B: Domain owns everything (CHOSEN)
- **Cómo funciona:** `attempts: 1` en BullMQ; el barrido es el único mecanismo de reintento;
  el dominio cuenta y dead-letterea.
- **Pros:** un solo árbitro (sin doble conteo); el barrido cubre perdidos y transitorios;
  dead-letter como decisión de dominio; bajo lock-in a BullMQ; arquitectura simple.
- **Cons:** el retry transitorio espera al próximo ciclo del barrido (latencia mayor que un
  backoff inmediato).
- **Por qué elegida:** simplicidad sobre inmediatez; disuelve el doble árbitro por diseño;
  la latencia de reproceso transitorio es tolerable a la escala actual. Reversible.

### Alternative C: Layered (per-failure-class)
- **Cómo funciona:** BullMQ reintenta transitorios de mensajes conocidos (backoff, config
  por-entorno); el dominio cuenta solo en el agotamiento de BullMQ; el barrido rescata perdidos.
- **Pros:** retry transitorio inmediato + red de seguridad del barrido.
- **Cons:** coordinación explícita para que BullMQ y el dominio no cuenten el mismo fallo
  (complejidad oculta); más acoplamiento a BullMQ.
- **Por qué no elegida (hoy):** la inmediatez no justifica la complejidad de coordinar dos
  contadores a la escala actual. Queda como **camino de migración**.

## Trade-off Matrix

| Criterio | A | B (elegida) | C |
|----------|---|-------------|---|
| Rescata mensajes perdidos | ❌ | ✅ | ✅ |
| Retry transitorio inmediato | ✅ | ❌ (ritmo del barrido) | ✅ |
| Dead-letter como decisión de dominio | ❌ | ✅ | ✅ |
| Árbitro único (sin doble conteo) | ✅ | ✅ | ⚠️ requiere coordinación |
| Complejidad / piezas móviles | Baja | Media | Alta |
| Lock-in a BullMQ | Alto | Bajo | Medio |

## Consequences

### Positive
- Un solo árbitro de reintentos (el dominio) → sin riesgo de doble conteo.
- El barrido cubre mensajes perdidos Y transitorios; el claim atómico hace segura la
  carrera cola↔barrido.
- Dead-letter permanece como decisión de negocio, desacoplada del transporte.
- Bajo lock-in: cambiar de cola no toca la política de retry/dead-letter.

### Negative
- Un fallo transitorio no se reintenta de inmediato: espera al próximo ciclo del barrido.
  **La cadencia del barrido pasa a ser load-bearing** para la latencia de reproceso.
- Se subutiliza una capacidad de BullMQ (su retry nativo) que ya está disponible.

### Migration path
Si la latencia de reproceso transitorio se vuelve inaceptable para el SLA, migrar a
**Alternative C**: activar el backoff de BullMQ para transitorios y coordinar que el
dominio incremente `retries` solo en el agotamiento de la cola. Trigger explícito:
métricas de tiempo-a-reproceso por encima del umbral de negocio.
