# 011 — Dead-Letter as Domain Annex Table

**Status:** Proposed (design-first)
**Date:** 2026-06-23
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

## Consequences

- **Positivas:** recovery observable y auditable; fuente de verdad única; reversible.
- **Negativas / a vigilar:** una superficie de persistencia más; el service ahora escribe
  en dos tablas en el path de fallo (mitigado: el anexo es append, no condiciona el estado).
- **Scope deliberado (YAGNI):** reinyección **manual** únicamente. Un job de auto-reprocess
  es quema innecesaria de infra para el MVP. Si los muertos se acumulan, se evaluará ad-hoc
  un script de bulk-reprocess — overkill hoy.
- **Abierto:** la state-machine formal de los estados terminales (resolved/rejected) queda
  para un ADR futuro cuando se construya el workflow de resolución manual.
