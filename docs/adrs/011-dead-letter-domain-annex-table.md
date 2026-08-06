# 011 — Dead-Letter as Domain Annex Table

**Status:** Accepted
**Date:** 2026-06-23 (Proposed, design-first) → 2026-06-24 (Accepted, implemented)
**Authors:** Juan Di Modugno
**Tags:** domain, reliability, dead-letter, observability, mvp

## Context

ADR-010 dejó el dead-letter como un **status** del evento (`pending_manual_review`
con `processed_at IS NULL`). Eso alcanza para "sacar el evento del ciclo de retry",
pero no para **operar** sobre los muertos: no hay registro de *por qué* murió cada
uno, *cuándo*, ni del *último error*. El hito MVP de S4 exige un flujo demostrable
webhook→async→falla→DLQ→recovery, y "recovery" necesita monitoreo activo + reinyección.

Restricciones y fuerzas:
- **MVP:** poca infra nueva tolerable; Postgres + BullMQ ya corren.
- El árbitro del estado de un evento es el **dominio en Postgres** (ADR-008/010), no la cola.
- Reversibilidad **alta hoy**: solo hay datos crudos, ninguna ejecución previa que migrar.
- Riesgo a evitar: **dual-write / drift** entre el estado del evento y el registro de muerte.

## Decision

Dead-letter modelado como **tabla de dominio anexa** (`dead_letter_events`), NO como
cola BullMQ dedicada.

Reparto:
- **`webhook_events` = única fuente de verdad** del estado del evento (`status`,
  `processed_at`). La pregunta "¿está muerto / pendiente de revisión?" se contesta acá.
- **`dead_letter_events` = anexo append-only** que apunta al evento (`event_id` FK) y
  agrega SOLO el contexto de la muerte: `reason`, `last_error`, `failed_at`. **N filas
  por evento** → audit trail de cada fallo/reintento manual; el último da la foto actual.
  No duplica el estado → no hay drift posible.
- **Reinyección:** un comando/endpoint `reprocess` toma un evento muerto y lo re-encola
  al pipe principal (reusa `enqueueEvent`, mismo core de procesamiento — ADR-010).
  En éxito → se actualiza `webhook_events` (processed). En fallo → se **appendea** una
  fila nueva al anexo. Trigger **manual** (operador), no automático.

## Alternatives Considered

### Alternative A: Status-only (estado actual)
- **Pros:** cero infra; reusa el barrido y el claim atómico.
- **Cons:** sin metadata del "por qué/cuándo"; monitoreo pobre; no hay audit de reintentos.
- **Por qué no:** no habilita el "recovery observable" que pide el MVP.

### Alternative B: Cola BullMQ de dead-letter dedicada
- **Pros:** mecánica de cola lista; mover jobs fallidos es directo.
- **Cons:** muertos en Redis = **volátiles**; le devuelve a la cola el rol de árbitro que
  ADR-010 le quitó al dominio; metadata efímera.
- **Por qué no:** contradice ADR-010 y pierde durabilidad/auditoría.

### Alternative C: Tabla de dominio anexa (CHOSEN)
- **Pros:** metadata rica y durable (Postgres); fuente de verdad única (anexo apunta, no
  copia); audit trail N:1; reusa claim atómico; reversible.
- **Cons:** una tabla + repo + extender el service para escribir el contexto.
- **Por qué elegida:** habilita monitoreo/recovery con drift imposible por diseño, a
  costo bajo y reversible.

## Trade-off Matrix

| Criterio | A (status) | B (cola) | C (anexo) |
|----------|-----------|----------|-----------|
| Infra nueva | ❌ | Redis queue | 1 tabla |
| Reusa claim atómico (ADR-008) | ✅ | ❌ | ✅ |
| Metadata del "por qué murió" | ⚠️ pobre | ❌ efímera | ✅ rica |
| Durabilidad | ✅ | ❌ | ✅ |
| Drift / dual-write | n/a | n/a | ✅ evitado (anexo apunta) |
| Audit trail de reintentos | ❌ | ❌ | ✅ (N:1) |

## Implementation note (2026-06-24) — double-write resuelto por orden, no por atomicidad

`transitionToManualReview` hace **dos** escrituras a la misma Postgres pero a dos repos
distintos: UPDATE de `webhook_events.status` + INSERT al anexo. Atomizar eso cruzando
repos cuesta (pasar un `tx` como parámetro, o colocar ambas escrituras juntas, o —peor—
retornar un `tx` abierto de un método = lifecycle hazard).

Decisión: **no se atomiza.** Análisis de fallas parciales:
- **(a)** status seteado, append falla → evento muerto **sin registro de muerte** (GRAVE).
- **(b)** append commitea, status falla → fila en el anexo apuntando a un evento todavía
  `received` → el recovery-sweep lo re-procesa (TOLERABLE, se auto-sana; la fila extra
  encaja con el modelo append-only N:1, no es bug).

Escribiendo **el append PRIMERO y el status después**, el caso (a) se vuelve
**inalcanzable por construcción** y solo queda el (b), tolerable. Mismo principio de
ordenamiento que el inbox/outbox (200-post-save): ordenar para que la inconsistencia
sobreviviente sea la inofensiva, en vez de pagar atomicidad. El orden está **protegido
por un test** de `invocationCallOrder` (validado por mutación).

## Amendment (2026-08-06) — one row per DEATH: the arbiter `(event_id, generation)`

### What changed underneath this ADR

The original rule was **no unique on `event_id`** — N rows per event is the audit
trail. That was correct while the only way to produce N rows was to die N times.
Two later decisions broke that assumption:

- **ADR-015** made an event able to die more than once (manual reinjection).
- **ADR-016** made `append` propagate, so BullMQ retries the whole transition up
  to 3 times — and those retries are **the same death**.

The annex then fused two counts: *"times it died"* and *"times we recorded a
death"*. ADR-015 reads the second while meaning the first — it derived the retry
attempt number from `count(*)` over the annex.

### The natural key of a death

Not time, not the error message: two retries of one transition differ in both and
are still one death. **Two deaths are separated by exactly one reactivation flip**,
which is the only exit from the terminal `pending_manual_review` state.

So `webhook_events.retries` — declared since the pre-BullMQ era and never
written — becomes the generation counter, incremented **inside the same statement**
as the atomic flip (the changing state is the lock; a separate UPDATE would open a
window where a reactivation has no generation, or the reverse).

```sql
UNIQUE (event_id, generation)   -- generation = webhook_events.retries at death
```

`generation` does not violate this ADR's invariant. `retries` remains the single
source of truth for how many times the event was reactivated; the annex freezes
**the generation in which this death occurred**, a fact that never changes again.
Same nature as `failed_at`, and the same distinction ADR-013 drew for `payload`:
an annex records audit facts, not a live view.

`onConflictDoNothing` is correct here — unlike in `DiscrepancyRepository.save`
(ADR-017 D4) — because this key captures everything that distinguishes the cases:
a conflict can only mean "already recorded", never "recorded, but changed".

`getFailureCountForEvent` is deleted. The attempt number for the reinjection
`jobId` now comes from the flip itself, which returns the new generation.

### Risk accepted, not fixed: the retry-after-flip window

`processSingleEventById` fetches the event and processes it **without a status
gate**. The atomic claim (`WHERE status = 'received' AND processed_at IS NULL`)
lives inside `markEventAsProcessed`, on the success path — while
`transitionToManualReview` runs before it. So a job retry whose flip already
succeeded re-runs the whole transition.

That is harmless today because `append` is idempotent per generation. It stops
being harmless in one window: if a **manual** reprocess (ADR-015) lands between
the successful flip and the job retry, `retries` moves, and the retry writes a
second row for the same death under a new generation. The arbiter cannot see it,
because the key changed underneath.

Not fixed here: gating `processSingleEventById` by status means deciding what
"processable" means, which is ADR-008 / ADR-015 territory, not a two-line patch.
**Revisit trigger:** the first automated (non-manual) reprocess path, which would
turn a human-timed window into a machine-timed one.

## Consequences

- **Positivas:** recovery observable y auditable; fuente de verdad única; reversible.
- **Negativas / a vigilar:** una superficie de persistencia más; el service ahora escribe
  en dos tablas en el path de fallo (mitigado: el anexo es append, no condiciona el estado).
- **Scope deliberado (YAGNI):** reinyección **manual** únicamente. Un job de auto-reprocess
  es quema innecesaria de infra para el MVP. Si los muertos se acumulan, se evaluará ad-hoc
  un script de bulk-reprocess — overkill hoy.
- **Abierto:** la state-machine formal de los estados terminales (resolved/rejected) queda
  para un ADR futuro cuando se construya el workflow de resolución manual.
