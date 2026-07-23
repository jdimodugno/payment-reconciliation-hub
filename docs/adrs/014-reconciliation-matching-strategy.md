# 014 — Reconciliation Matching Strategy: Re-derive, Don't Trust

**Status:** Accepted
**Date:** 2026-07-23
**Authors:** Juan Di Modugno
**Tags:** domain, reconciliation, matching, audit, batch

## Context

ADR-013 modeló *qué es* una discrepancia (una fila por par×dimensión) y su persistencia,
pero dejó **explícitamente abierto** el algoritmo de *matching*: **cómo se emparejan
interno↔provider antes de comparar**. Este ADR cierra ese punto.

El batch de reconciliación cruza dos universos:
- **Lado interno** — `transactions`. Cada `Transaction` lleva `providerId` + `externalId`
  (la referencia al pago en el provider) materializados como columnas.
- **Lado provider** — la voz del provider. Hoy esa voz son los `webhook_events` recibidos.
  El `externalId` del recurso **no está materializado** como columna: vive dentro del
  `payload` crudo (decisión de ADR/d17: se guarda el crudo, no un derivado sensible a bugs).

Fuerza adicional: durante el processing, el pipeline ya dejó un **link materializado** —
`webhook_events.transactionId` apunta a la `Transaction` que ese evento generó (o `NULL`
si nunca se procesó / quedó dead-lettered). O sea, **un matching ya existe**, puesto por el
mismo pipeline que la reconciliación debe auditar.

Restricciones y fuerzas:
- **Propósito del engine:** *auditar* la salud del sistema, no asumirla.
- **Anti-corruption / raw-only (d17):** `webhook_events` guarda el payload crudo; meterle
  columnas derivadas rompe esa pureza y arriesga drift.
- **Escala actual baja** (founder/MVP); alta reversibilidad (no hay batch corriendo aún).
- **T5:** los eventos no-enriquecibles ya tienen dueño (dead-letter, ADR-010/011).

## Decision

El batch **re-deriva** el emparejamiento por la clave **`(providerId, externalId)`**,
de forma **independiente** del `transactionId` que dejó el pipeline. **Auditar, no confiar.**

- **Full outer join, no lookup.** Se cargan **ambos** universos, se indexan por
  `(providerId, externalId)` y se recorre la **unión de claves**. La discrepancia vive en la
  **diferencia simétrica** (solo un lado presente → `missing_*`) *más* los mismatches de la
  intersección (`amount` / `state`). Iterar un solo lado haciendo lookups del otro cegaría al
  engine frente a lo que ese lado no tiene (`missing_internal`).
- **Clave compuesta.** `providerRef` solo colisiona entre providers distintos; `providerId`
  escopea la clave para que dos pagos de providers distintos no se fusionen en un falso match.
- **Fuente del lado provider = re-enriquecer al vuelo.** El `externalId` (y `amount`/`status`)
  se extraen del `payload` crudo en tiempo de batch, reusando la **misma cadena**
  (`parseWebhook` → `fetchDetails`) que creó la `Transaction`. Sin cambiar el schema. Un solo
  paso de enrichment resuelve *clave de join* + *campos a comparar*.
- **El link del pipeline es evidencia, no verdad.** `transactionId` no se usa como clave de
  join; queda disponible como un dato más que también se puede auditar.
- **Arquitectura: functional core / imperative shell.** El index + full outer join +
  clasificación son **dominio puro** (`reconcile()`, sin DB, testeable con arrays); el I/O
  (cargar, enriquecer, persistir) vive en los **bordes** (service/repo, T3).

## Alternatives Considered

### Alternative A: Join por el `transactionId` materializado (confiar en el link del pipeline)
- **Pros:** el más barato — el link ya está resuelto, sin re-enrichment.
- **Cons:** el auditor **hereda la afirmación que audita**. Si el pipeline linkeó mal (o no
  linkeó: `transactionId = NULL`), el join por ese link **se auto-absuelve** y el bug queda
  invisible. Ciego al desacople que es justamente lo que hay que detectar.
- **Por qué no:** viola el propósito del engine (auditar ≠ confiar).

### Alternative B: Re-derive por `(providerId, externalId)`, full outer join — CHOSEN
- **Pros:** independiente del pipeline → **puede contradecirlo**; detecta los cuatro kinds,
  incluidos `missing_*` y el `transactionId = NULL`; alineado con la partición futura por
  provider (la clave incluye `providerId`).
- **Cons:** paga un re-enrichment por corrida; carga ambos universos en memoria (ver Escala).
- **Por qué elegida:** es la única forma en que la reconciliación puede afirmar algo que el
  pipeline no dijo.

### Alternative C: Inner join / lookup de un solo lado
- **Pros:** simple; suficiente para `amount`/`state`.
- **Cons:** solo ve la **intersección** → **pierde `missing_internal`** (nunca visita lo que
  el lado interno no tiene). Media auditoría.
- **Por qué no:** la ausencia bidireccional es parte central del modelo (ADR-013).

### Alternative D: Materializar `externalId` como columna en `webhook_events`
- **Pros:** join directo sin re-enrichment.
- **Cons:** rompe la pureza **raw-only** (d17); un campo derivado puede **driftear** del
  payload; agrega un dato procesado a la tabla que decidimos mantener cruda.
- **Por qué no:** el costo del re-enrichment (B) es de cómputo; el de D es de **corrección de
  datos** (drift) — peor moneda.

## Trade-off Matrix

| Criterio | A | B ✅ | C | D |
|---|---|---|---|---|
| Puede contradecir al pipeline (auditar) | ❌ | ✅ | ✅ | ✅ |
| Detecta `missing_internal` | ❌ | ✅ | ❌ | ✅ |
| Sin drift de datos derivados | ✅ | ✅ | ✅ | ❌ |
| Sin cambio de schema | ✅ | ✅ | ✅ | ❌ |
| Costo por corrida | mínimo | re-enrichment | bajo | mínimo |

## Consequences

- **Positivas:** el núcleo de decisión es una función pura testeable sin DB; el engine puede
  detectar desacoples del pipeline; la clave compuesta previene falsos matches cross-provider
  (probado con test).
- **Tautología de misma-fuente (limitación honesta):** como el lado provider se re-enriquece
  con la **misma tubería** que creó la `Transaction`, el *happy path* nunca diverge por sí
  solo. El valor honesto de hoy NO es "reconciliar dos fuentes independientes" (eso es M2/M3,
  con un pull/settlement propio del provider) sino: **(a)** el motor completo listo para
  enchufar esa fuente independiente cambiando solo `findProvider`, y **(b)** detección de
  **drift real** si una `Transaction` se muta por otro camino. Se demuestra inyectando
  divergencia, sin mentirse sobre el alcance.
- **T5 — evento no-enriquecible:** un `webhook_event` cuyo raw no se puede enriquecer NO es
  una discrepancia provider↔interno (es un fallo de procesamiento interno, dueño =
  dead-letter, ADR-010/011). El batch lo **saltea**, y saltear es seguro **solo porque otro
  mecanismo garantiza su visibilidad** (`pending_manual_review`). Si esa garantía no
  existiera, saltear sería silenciar (T5 violado).
- **Escala (in-memory full outer join):** aceptable a la escala actual; queda corto en
  escala alta (ambos universos en memoria). Escalera de escape, en orden:
  1. **Partición por provider** — *lossless* porque la clave de join incluye `providerId`
     (no existe par cross-provider → ninguna partición parte un par).
  2. **Chunks keyed** — cortar en porciones manejables **hasheando por `pairKey`**, no por
     índice, para que los dos lados de una misma clave caigan en el mismo chunk.
  3. Si sigue corto: empujar el join a la DB u otras alternativas.
- **Abierto (hereda de ADR-013):** la fuente independiente del provider (pull/settlement) y
  la state-machine de resolución. Este ADR deja el motor listo para la primera.

## Verification

`reconcile()` probado con arrays (functional core, sin DB): par-limpio, `amount`, `state`
(guarda `providerStatus` crudo), **ambos-difieren = 2 discrepancias** (ADR-013 dec B),
`missing_internal`, `missing_provider`, y **`providerId`-scoping** (mismo `providerRef` de
providers distintos → dos huérfanos, no un falso match). El imperative shell (wiring de
`findProvider`/re-enrichment + orquestador) se implementa por separado.
