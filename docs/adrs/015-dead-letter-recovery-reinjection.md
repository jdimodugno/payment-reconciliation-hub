# 015 — Dead-Letter Recovery / Reinjection Mechanism

**Status:** Accepted
**Date:** 2026-07-28 (Proposed + Accepted, implementado el mismo día)
**Authors:** Juan Di Modugno
**Tags:** domain, reliability, dead-letter, recovery, mvp

## Context

ADR-011 modeló el dead-letter como tabla anexa append-only y **dio por hecha** la
reinyección: *"un comando `reprocess` toma un evento muerto y lo re-encola al pipe
principal, reusa `enqueueEvent`, mismo core. Trigger manual."* También dejó abierta
la state-machine de estados terminales (`resolved`/`rejected`) para un ADR futuro.

Al implementar el recovery aparece un choque que ADR-011 no vio: el core de
procesamiento termina en `markEventAsProcessed`, cuyo claim atómico (ADR-008) filtra
`WHERE status = 'received'`. Un evento en `pending_manual_review` re-encolado por esa
vía matchea **0 filas** → `already_processed` → **no-op silencioso**. La reinyección
que ADR-011 dio por resuelta **no funciona con la maquinaria actual**.

La causa raíz: `status = 'received'` en el claim era un **proxy**. El árbitro real de
idempotencia — "no procesar dos veces" — es `processed_at IS NULL`; el status era una
correlación histórica (hasta hoy "procesable" y "received" eran sinónimos). Hacer
procesable un muerto exige reconciliar esa fusión.

Restricciones y fuerzas:
- **MVP / volumen bajo:** no se paga construir maquinaria de automatización hoy.
- El árbitro del estado sigue siendo el **dominio en Postgres** (ADR-008/010/011).
- Reinyección **manual** (decisión heredada de ADR-011, se respeta).
- Reversibilidad alta: no hay ejecución previa que migrar.

## Decision

La reinyección se implementa como **flip transitorio de estado**, disparado por un
comando manual `reprocess(eventId)` sobre un evento en `pending_manual_review`:

1. **Flip** `pending_manual_review → received` (update de una sola columna; `processed_at`
   y `transaction_id` de un muerto no-procesado ya están en null → no requieren reset).
2. Reusa `enqueueEvent` → **maquinaria intacta**: el claim sigue gated en `received`
   (segunda barrera preservada) y el `jobId` dedup previene doble-encolado.
3. **Éxito** → el evento queda `processed` por el claim normal.
4. **Fallo** → vuelve a `pending_manual_review` + se **appendea** una fila nueva al anexo.
   Se mantiene el orden de escritura *append-primero* del ADR-011 (la inconsistencia
   sobreviviente es la inofensiva).

El claim **NO se modifica**: sigue arbitrando por `status='received' AND processed_at
IS NULL AND transaction_id IS NULL`. Se elige mantener el gate de status como defensa
en profundidad en lugar de ampliarlo a `processed_at IS NULL`.

**Alcance:** trigger manual únicamente. La state-machine terminal (`resolved`/`rejected`)
sigue diferida (ADR-011): con trigger manual, el **operador** es el guardián de qué se
reinyecta, así que no se necesita modelar el terminal todavía.

## Alternatives Considered

### Alternative 1: Ampliar el árbitro (claim por `processed_at IS NULL`)
- **Cómo funciona:** el claim deja de filtrar por `status`; arbitra solo por
  `processed_at IS NULL`. Un `pending_manual_review` se procesa **in-place**, sin flip.
- **Pros:** `status` queda puro (nunca "miente"); no se toca el estado auditable.
- **Cons:** la seguridad se **muda** del claim al trigger → queda **una sola barrera**.
  Si el trigger se equivoca y levanta un no-recuperable (`UNSUPPORTED_CURRENCY`), ya no
  hay red abajo: se procesa (o vuelve a morir) sin freno.
- **Por qué no:** sacrifica defensa en profundidad justo en el path de fallo; con trigger
  manual el beneficio (status puro) no compensa perder la segunda barrera.

### Alternative 2: Flip transitorio (CHOSEN)
- **Cómo funciona:** ver Decision. Flip `→ received`, reusa el pipe, dos barreras.
- **Pros:** cero cambio de schema; reusa claim + jobId + sweep sin tocarlos; dos barreras
  intactas; el más barato de shippear hoy.
- **Cons:** la **transición de revival no deja rastro** — el anexo registra *muertes*, no
  *reinyecciones* → un `received` reinyectado es **indistinguible** de uno orgánico.
- **Por qué elegida:** con volumen bajo y trigger manual, la pérdida de trazabilidad del
  revival no duele hoy, y evita tanto la maquinaria de la Opción 3 como la barrera perdida
  de la Opción 1.

### Alternative 3: Flip + marca de procedencia
- **Cómo funciona:** como la 2, más un campo/tabla que marca "este received es reinyectado",
  seteado solo por el flujo de recovery. Da correlación intento↔resultado.
- **Pros:** conserva las dos barreras **y** la trazabilidad del revival; distingue
  orgánico de reinyectado.
- **Cons:** estado nuevo **sin consumidor a escala M1** (la distinción orgánico/reinyectado
  ya es inferible: 0 filas de anexo = orgánico, ≥1 = reinyectado). Un marker adicional
  duplica una verdad que el anexo ya contiene, salvo la correlación por-intento — que hoy
  nadie lee.
- **Por qué no (hoy):** flaggeada por YAGNI. Es la evolución natural cuando el trigger se
  automatice o el volumen haga la correlación operacionalmente necesaria (ver *When to Revisit*).

## Trade-off Matrix

| Criterio | 1 (ampliar árbitro) | 2 (flip transitorio) | 3 (flip + marker) |
|----------|--------------------|--------------------|-------------------|
| Cambio de schema | ❌ ninguno | ❌ ninguno | ⚠️ campo/tabla nueva |
| Reusa maquinaria (claim/jobId/sweep) | ⚠️ toca el claim | ✅ intacta | ✅ intacta |
| Barreras contra reprocesar no-recuperable | ⚠️ 1 (solo trigger) | ✅ 2 | ✅ 2 |
| `status` puro (no "miente") | ✅ | ❌ | ❌ (pero trazable) |
| Trazabilidad del revival | ❌ | ❌ | ✅ correlación intento↔resultado |
| Costo de shippear hoy | Medio | **Bajo** | Alto |

## Implementation note (2026-07-28) — el `jobId` determinístico estorba al reprocess

Al implementar apareció un choque que el diseño no anticipó: `enqueueEvent` usa
`jobId = ${JOB_NAME}_${eventId}` (determinístico, elegido para idempotencia de encolado
del path orgánico). Pero la cola **no** tiene `removeOnComplete`, y un evento que va a
manual review **completa** el job con éxito (`processSingleEvent` no tira). Ese job queda
en estado *completed* con ese jobId → re-agregar el mismo jobId en el reprocess sería un
**no-op silencioso** (BullMQ deduplica por jobId).

Ironía registrada: la misma decisión que da idempotencia al path orgánico estorba al
reprocess. Decisión: **jobId por-intento** — sufijo `_retry_${n}` donde `n` = count de
filas del anexo para el evento (= cuántas veces murió). Da un job fresco por intento **y**
un rastro del intento en el propio jobId (un pedazo de la correlación que la Opción 3 daría).
Se pierde el dedup determinístico para el reinyectado, pero el **claim atómico**
(`WHERE status='received'`) serializa igual → la 2ª barrera cubre. El trigger manual (+ un
bloqueo de re-trigger en la futura UI) es la 1ª barrera.

Superficie implementada: `POST /webhooks/:eventId/reprocess` → 202; 404 si no existe,
409 si no está en `pending_manual_review`. Flip atómico en el repo
(`reactivateForReprocess`, `WHERE status='pending_manual_review'` como árbitro). El camino
de re-muerte reusa `transitionToManualReview` (append + vuelta a manual review), sin código
nuevo. Cubierto por 4 unit + 2 e2e (el happy-recovery e2e prueba que el jobId NO se
dedupea: si lo hiciera, el evento nunca saldría de manual review).

## Consequences

### Positive
- Recovery funcional reusando el pipe existente, sin migración ni schema nuevo.
- Se preservan las dos barreras de idempotencia en el path de fallo.
- Se descubre y documenta que `processed_at` (no `status`) es el árbitro real — clarifica
  el modelo para futuros ADRs.

### Negative
- La transición de revival es **untraced**: un `received` reinyectado no se distingue de
  uno orgánico mirando `webhook_events`. La procedencia solo es inferible por el `count`
  del anexo (grueso), no por correlación por-intento.
- El comando fuerza un update sobre `status` en el camino de recovery (mutación de estado,
  aceptada por diseño desde ADR-011).

### Risks
- **Riesgo:** el operador reinyecta un muerto genuinamente no-recuperable
  (`UNSUPPORTED_CURRENCY` sin que se haya agregado soporte) → muere de nuevo, ruido en el
  anexo. **Mitigación:** append-primero mantiene el anexo consistente; el bucle es visible
  (N filas crecientes con mismo reason) y auto-contenido; el operador tiene el `reason`
  a la vista antes de disparar.

## When to Revisit

- Cuando el trigger deje de ser manual y pase a **automático** (sweep) → ahí la Opción 3
  (marker/correlación) **y** la state-machine terminal (`resolved`/`rejected`) dejan de ser
  YAGNI: un sweep necesita saber qué está resuelto vs. intentable sin un humano decidiendo.
- Cuando el **volumen** de reinyecciones haga que la correlación por-intento importe
  operacionalmente (debugging, auditoría de quién disparó qué).

## References

- ADR-008 — Webhook processing idempotency (claim atómico, `processed_at` como árbitro)
- ADR-010 — Retry & dead-letter strategy (domain-owned)
- ADR-011 — Dead-letter as domain annex table (append-only; describió la reinyección, difirió el terminal)
