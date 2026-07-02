# 013 — Discrepancy Modeling: One Row per (Pair, Dimension)

**Status:** Proposed (design-first)
**Date:** 2026-07-02
**Authors:** Juan Di Modugno
**Tags:** domain, reconciliation, modeling, audit, mvp

## Context

El reconciliation engine compara dos fuentes de verdad —el registro **interno** y lo
que reporta el **provider**— y produce **discrepancias**: situaciones que requieren una
acción del operador (regularizar de nuestro lado, o —más raro— informar al provider).

Tres tipos de discrepancia, con semántica de negocio distinta:
- **Monto:** el par existe en ambos mundos pero los importes no coinciden
  (provider $200 / interno $20).
- **Estado:** el par existe en ambos pero los estados difieren (provider `cancelled` /
  interno `succeeded` — puede enmascarar un refund no sincronizado).
- **Ausencia (bidireccional, dos sub-casos NO simétricos):**
  - *interno sin externo:* típicamente una tx que aún no se ejecutó (intención que puede
    cambiar entre la hora 1 y la hora 3) → requiere re-confirmación del usuario.
  - *externo sin interno:* el provider tiene algo que nosotros no → **requiere acción**;
    la gravedad depende del tipo (un depósito es directo; un retiro exige verificación de
    saldos, más delicado).

Fuerza que dispara el ADR: **un mismo par puede discrepar en más de una dimensión a la
vez** (monto Y estado). Cómo se modela eso condiciona la resolución futura.

Restricciones y fuerzas:
- **MVP:** el workflow de resolución (estados terminales `resolved`/`rejected` + audit del
  operador) está **diferido** (ver ADR-011 "Abierto"). El modelo de hoy NO debe cerrarle
  la puerta.
- **T1 (Money):** todo importe es tipo `Money`, nunca `number`.
- Reversibilidad **alta**: no hay discrepancias persistidas todavía.

## Decision

Una discrepancia = **una dimensión que discrepa, de un par**. Grano fino: si un par
difiere en monto Y estado, se generan **dos** discrepancias (una `amount`, una `state`).

- **Persistimos** las discrepancias (no se computan sólo al vuelo — ver Alternative D).
  El anclaje persistido es lo que el workflow de resolución futuro necesita para colgar
  *quién resolvió / cuándo* — auditoría, no interpretación de una foto volátil.
- **Modelo de dominio = union discriminado por `kind`.** Cada variante carga *exactamente*
  los datos que su tipo necesita, y ninguno de los que no (estados ilegales
  irrepresentables — "Parse, don't validate"):
  - `amount_mismatch`: `internalAmount: Money`, `providerAmount: Money`.
  - `state_mismatch`: `internalStatus`, `providerStatus`.
  - `missing_internal`: existe en el provider, no en interno + los datos del lado presente
    (provider).
  - `missing_provider`: existe en interno, no en el provider + los datos del lado presente
    (interno).

  La ausencia se modela como **dos `kind` separados**, no como uno con un flag `presentIn`:
  los sub-casos no son simétricos (acciones de negocio distintas), así que el nombre del
  tipo carga esa asimetría en vez de esconderla en un campo.
- **Persistencia (T3, separada del dominio):** tabla con un discriminador `kind` +
  columnas por dimensión (nullable según variante). El repo mapea row ↔ union; la
  ilegalidad la garantiza el **tipo de dominio**, no la tabla.
- **"¿Este par está reconciliado?"** deja de ser un flag en una fila y pasa a ser un
  **query derivado**: *no existe ninguna discrepancia sin resolver para el par*. Misma
  forma que la lente read-only de ADR/endpoint `reconciliation-status`.

## Alternatives Considered

### Alternative A: Una fila por par, `mismatchType` único
- **Pros:** vista de revisión simple (un problema por transacción conflictiva).
- **Cons:** un valor único no representa "monto Y estado difieren"; y resolver el registro
  produce un **ACK indirecto** —el operador cierra pensando en el monto y el estado queda
  dado por resuelto sin haberlo mirado.
- **Por qué no:** pierde dimensiones y arriesga marcar resuelto lo no revisado.

### Alternative B: Una fila por (par, dimensión) — CHOSEN
- **Pros:** resolución **granular** sin ACK fantasma; representa multi-dimensión; deja
  lugar limpio para el workflow de resolución futuro.
- **Cons:** "par reconciliado" es **agregado** (no flag directo) → más trabajo de lectura;
  la UX debe mostrar el par como flagrante hasta que TODAS sus discrepancias se resuelvan.
- **Por qué elegida:** la auditoría exige granularidad; el costo (agregación) es de lectura,
  no de corrección de datos.

### Alternative C: Una fila por par + sub-flags de resolución por razón
- **Pros:** vista unificada (pro de A) + ACK granular (pro de B).
- **Cons:** schema más complejo y **ya modela resolución** que decidimos diferir (YAGNI).
- **Por qué no:** construye la habitación de resolución antes de que exista.

### Alternative D: No persistir — computar discrepancias al vuelo
- **Pros:** cero storage; alineado con "derivar, no almacenar" (sin drift posible).
- **Cons:** no hay dónde **colgar el estado de resolución** cuando se construya el workflow;
  una auditoría necesita un registro estable, no una foto recomputada.
- **Por qué no:** el diferido no es "nunca"; D cerraría esa puerta.

## Trade-off Matrix

| Criterio | A | B ✅ | C | D |
|---|---|---|---|---|
| Representa multi-dimensión | ❌ | ✅ | ✅ | ✅ |
| ACK granular (sin fantasma) | ❌ | ✅ | ✅ | n/a |
| "¿Par reconciliado?" | flag directo | agregado | agregado | query puro |
| Complejidad de schema | baja | media | alta | nula |
| Deja lugar a resolución futura | ⚠️ | ✅ | ✅ (ya la modela) | ❌ |
| Auditabilidad (registro estable) | ⚠️ | ✅ | ✅ | ❌ |

## Consequences

- **Positivas:** resolución granular y auditable; multi-dimensión nativo; estados ilegales
  irrepresentables por el union discriminado; "reconciliado" derivado (sin drift).
- **Negativas / a vigilar:** "par reconciliado" es un agregado → la UX y las queries deben
  manejar el N:1 par→discrepancias; una tabla + repo + mapper nuevos (más storage).
- **Scope deliberado (YAGNI):** NO se construye el workflow de resolución
  (`resolved`/`rejected` + audit del operador). El modelo sólo garantiza que ese workflow
  futuro tenga dónde anclarse.
- **Abierto:** la state-machine de resolución y el algoritmo de *matching* (cómo se emparejan
  interno↔provider antes de comparar) quedan para ADRs futuros. Los datos para emparejar ya
  existen (identificadores de recurso/pago); se difiere la formalización, no la viabilidad.
