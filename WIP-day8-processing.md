# WIP — Día 8: terminar el procesamiento de webhooks (idempotencia de procesamiento)

> Handoff para cerrar el bloque proyecto del Día 8. Diseño ya decidido en **ADR-008**
> (claim atómico + transacción de DB). Acá queda **qué falta implementar y POR QUÉ**,
> con contexto para no re-razonar. NO hay soluciones escritas: el código lo ponés vos.
> Archivos: `src/modules/webhooks/webhooks.service.ts` y `webhooks.repository.ts`.

Orden sugerido: primero lo estructural (1-2), después modelado (3-6), después tests (7).

---

## 1. Service — el loop de procesamiento no corre bien (`processPendingEvents`, ~línea 42)

Tres bugs encadenados que hoy hacen que el procesamiento **literalmente no funcione**:

- **(a) Condición invertida (línea 46):** hoy es `if (status === 'none')` y *adentro*
  iterás `.elements`. Si el status es `'none'`, **no hay elementos** — estás procesando
  el caso vacío y salteando el caso real. Querés procesar cuando hay eventos
  (`'found'`), no cuando no los hay.
- **(b) `forEach(this.processSingleEvent)` (línea 53):** dos problemas distintos.
  - **`this` se pierde:** pasás el método como referencia suelta; cuando `forEach` lo
    invoca, `this` no es la instancia → `this.providerService` queda `undefined` en
    runtime. (Es el gotcha clásico de JS que ya tocaste el Día 5.)
  - **`forEach` ignora `async`:** `processSingleEvent` es async, pero `forEach` no
    espera. Resultado: fire-and-forget, los errores de cada evento se tragan y no hay
    backpressure si son muchos. Querés iteración **awaiteada** (un `for...of` con
    `await`) o concurrencia controlada — pero NO `forEach`.
- **(c) `markEventAsProcessed` sin `await` (línea 90):** misma familia — disparás la
  promesa y no esperás su resultado (ni manejás su status de retorno).

**Por qué primero:** sin esto, todo lo demás es teórico — el flujo no se ejecuta de
verdad. Verificación: un test que mete 1 evento pending y chequea que se procesó.

---

## 2. Repo — el `catch` se traga los errores que no son rollback (A2, ~línea 197)

Hoy el `catch` hace `if (error instanceof TransactionRollbackError) { ... }` y **no
tiene `else`**. Trazá una DB que se cae en medio del upsert:

1. Tira un error que **no** es `TransactionRollbackError`.
2. Entra al catch, el `if` da `false`, no hace nada.
3. Sale del catch → cae al `return { status: 'failed', result: null }` final.

**El error desapareció**: sin log, sin rethrow, sin contexto. Y un fallo de **infra**
(DB caída) queda indistinguible de un fallo de **negocio**. Eso es T5 violado: un catch
o **maneja** con lógica de dominio o **re-lanza con contexto** — comérselo no es opción.

**Falta la rama del error inesperado** (rethrow). Regla mental: el `catch` solo debe
*absorber* el caso que sabés manejar (rollback → retries) y *propagar* el resto.

---

## 3. Service — currency: hay DOS chequeos con DOS significados (línea 70 y repo post-returning)

No son lo mismo, y hoy los tratás parecido (ambos `throw Error` pelado):

- **#1 — Service, línea 70 (`enrichedEventData.currency`):** es la **primera vez** que
  ves la currency que devuelve el provider en `fetchDetails`. Recordá: en **recepción**
  guardás el raw **sin** validar currency (recepción no enriquece). Entonces una currency
  **no soportada** acá es un **caso de dominio legítimo** ("evento no soportado", tu deuda
  del Día 3), no un crash. Decisión pendiente: ¿la descartás limpio, o la mandás a
  `pending_manual_review`? Lo que NO va: `throw new Error(...)` genérico que pierde el
  modelado.
- **#2 — Repo, después del `.returning()`:** ahí re-leés lo que **acabás de escribir**.
  Si *eso* sale inválido es "no debería pasar nunca" → **throw defensivo** correcto
  (igual que el guard de `processedAt`). Tu razonamiento *"si se persistió era válido →
  un inválido significa que cambió el catálogo de monedas → revisión humana"* aplica
  **acá (#2)**, no al #1.

**Acción:** modelar #1 como salida de dominio (no excepción); dejar #2 como guard
defensivo. Son dos decisiones separadas.

---

## 4. Service — `type` y `status` hardcodeados (líneas 80-83)

Hoy ponés `type: 'payout'`, `status: 'settled'` fijos. La pregunta de diseño:
**¿de quién es la responsabilidad de clasificar el evento?**

Contexto (tu learning del Día 7): el campo de clasificación es **asimétrico por provider**
— Stripe usa `type`, MercadoPago usa `action`. Quién conoce ese mapeo es el **provider**,
no el service. El `parseWebhook`/`fetchDetails` de cada provider (su anti-corruption
layer) debe **normalizar** su campo propio al `type`/`status` **canónico** del dominio.

**Dirección:** que `EnrichedProviderEvent` **traiga ya** `type` y `status` normalizados;
el service solo los lee (`enrichedEventData.type`). El service no debe decidir
clasificación — no conoce las particularidades de cada provider, y hardcodear rompe con
el segundo tipo de evento. Esto es T3 (cada provider encapsula su traducción).

**Decisión abierta (posible mini-ADR):** ¿dónde vive el mapeo provider-field → domain-enum
y cómo se modela (switch / map / método del provider)? Si las alternativas son reales,
amerita ADR-009.

---

## 5. Repo — el `retries++` (~línea 199-204): dos arreglos

- **(a) Sintaxis SQL:** hoy `sql\`select retries + 1\`` es un subquery sin `from`,
  malformado. Para incrementar una columna en su propio UPDATE se referencia la columna:
  forma `sql\`${webhooksTable.retries} + 1\`` → compila a `SET retries = "..."."retries"
  + 1` (lee el valor de la fila y suma, atómico). Sin subquery.
- **(b) El `.where()` no identifica una sola fila:** hoy filtra solo por
  `externalEventId`. Pero la identidad es **compuesta** (ADR-007:
  `UNIQUE(providerId, externalEventId)`) — el mismo `externalEventId` puede existir para
  dos providers. Falta agregar `providerId` al `and(...)`, sino podés incrementar retries
  en filas de otro provider.

---

## 6. Diseño — falta el dead-letter (`pending_manual_review`, del ADR-008)

Hoy incrementás `retries` y siempre devolvés `failed`, pero **nunca sacás el evento del
pool automático**. Consecuencia: un evento que falla de verdad se reintenta para siempre
(loop infinito).

**Falta:** al llegar a **N** reintentos, transicionar el evento a `pending_manual_review`
(o estado equivalente). Y `getPendingWebhookEvents` debe **excluir** esos eventos de la
lista de pendientes (sino los vuelve a pickear). Decisión: ¿cuál es N? ¿dónde se evalúa
el umbral (después de incrementar)?

---

## 7. Confirmar la 3ra salida `already_processed` end-to-end

Ya la modelaste en el repo (claim.length === 0 = duplicado ya procesado = NO es failed,
NO incrementa retries). Falta verificar que **el service la propague**: hoy
`processSingleEvent` no mira el status de retorno de `markEventAsProcessed`. Los tres
casos (`processed` / `already_processed` / `failed`) deberían tener tratamiento distinto
(aunque sea distinto log). Recordá: `already_processed` es **éxito idempotente**, no error.

---

## 8. Tests (T2 — no opcional)

El código nace con tests. Mínimo a cubrir:

- **e2e idempotencia (el que prueba la verdad):** mismo evento procesado 2x →
  `count(transactions) === 1`. Es la aserción que cuenta la verdad (como en recepción,
  Día 7). Probar también que el 2º intento devuelve `already_processed` y **no** toca
  `retries`.
- **Unit:** currency no soportada (#1) → la salida de dominio que decidas, no un 500.
- **Unit:** fallo real (mock que tira) → retries incrementa **una** fila correcta
  (providerId + externalEventId) y, al llegar a N, `pending_manual_review`.
- **Unit/e2e:** `type`/`status` se derivan del provider correcto (Stripe vs MP).

---

## 9. Verificar antes de correr (runtime, fácil de olvidar)

`onConflictDoUpdate({ target: transactionsTable.externalId })` requiere que `externalId`
tenga un **índice UNIQUE** en el schema/migración. Si no lo tiene, explota en runtime
aunque compile. Chequear el schema de `transactions` y, si falta, agregar la migración.

---

## Cierre del día (cuando esto esté verde)

1. `/check day8 project` (criterios: T2 tests, T3 capas, T5 errores modelados, A3
   defendible).
2. Actualizar `evidence/` (learnings + artifact del flujo).
3. `progress.md` Día 8 completo + commit (un commit/día) — del study-plan y del proyecto.
4. Recién ahí `/start day9`.

---

## DEUDA ABIERTA (post Día 8) — dónde vive la validación de currency

**Decisión tomada (Opción A), NO implementada aún:** la validación "currency no soportada"
debe vivir en el **dominio (service)**, no en el enrichment (Money/provider).

**Por qué:** hoy `fetchDetails` valida currency de forma IMPLÍCITA vía
`Money.fromMinorUnits(amount, currency)`, que TIRA con currency inválida ANTES de devolver.
Resultado: el guard de currency del service (`isValidCurrency(enrichedEventData.currency)
→ pending_manual_review`) está **muerto/bypasseado** — un payload real con currency inválida
hace throw en fetchDetails, no se rutea a manual review, y como nunca llega a
`markEventAsProcessed` (donde vive el retries++), el evento **cicla infinito sin dead-letter**.
Con N providers, esa validación temprana se vuelve molesta y duplicada.

**Plan de implementación:**
1. `fetchDetails` deja de convertir el amount con Money → devuelve **amount crudo (minor units
   / string) + currency cruda** en `EnrichedProviderEvent` (cambio de contrato).
2. La conversión a Money se mueve al **service, DESPUÉS** del guard de currency (cuando ya
   se validó que es soportada).
3. Así el guard `UNSUPPORTED_CURRENCY → pending_manual_review` se vuelve alcanzable y la
   decisión de dominio queda en una sola capa.

**Tests afectados:** una vez implementado, `UNSUPPORTED_CURRENCY` pasa a ser **e2e-alcanzable**
(hoy solo unit con mock). Agregar el caso e2e ahí.

**Relacionado:** el guard `UNSUPPORTED_EVENT_TYPE` es defensivo/unreachable e2e por diseño
(el provider rechaza types no procesables + Record exhaustivo) → se queda en unit. NO es deuda,
es correcto.
