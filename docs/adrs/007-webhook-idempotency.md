# 007 — Idempotencia en la recepción de webhooks

**Status:** Accepted
**Date:** 2026-06-06
**Authors:** Juan Di Modugno
**Tags:** webhooks, idempotency, reliability, postgres, T5, T3

## Context

Los providers de pago (Stripe, MercadoPago) entregan eventos con semántica
**at-least-once**: ante incertidumbre de entrega, reintentan. El mismo evento puede
llegar dos o más veces (retry del provider, doble POST, redelivery). Procesarlo más
de una vez produciría efectos duplicados (en última instancia, transacciones dobles).

El endpoint `POST /webhooks/:providerId` debe garantizar que recibir el mismo evento
N veces produzca el mismo resultado observable, sin efecto secundario adicional.

Restricciones del contexto:
- El identificador del evento (`externalEventId`) lo controla el **provider**, no
  un cliente nuestro (a diferencia de una idempotency-key client-facing).
- El endpoint puede recibir **concurrencia/redelivery** (dos entregas del mismo
  evento casi simultáneas).
- El schema ya tiene `UNIQUE(providerId, externalEventId)` en `webhook_events`
  (Día 3) y `webhook_events.payload` como `jsonb` para replay.

Este ADR cubre la idempotencia de **RECEPCIÓN** (dedup del webhook). La idempotencia
de **PROCESAMIENTO** (evitar la doble Transaction al enriquecer) es una decisión
separada → ver Día 8 (ADR futuro).

## Decision

La guarda de idempotencia es el **constraint `UNIQUE(providerId, externalEventId)`
de la base de datos**, no una verificación a nivel aplicación.

Flujo en el repository:
1. `INSERT` directo del evento (raw persistido antes de procesar).
2. Si la DB lanza un unique-violation (SQLSTATE `23505`, expuesto por Drizzle en
   `error.cause`): el evento ya existía → `SELECT` del registro previo y se devuelve.
3. Cualquier otro error de DB se re-lanza (T5: no se silencia).

El repository/service devuelven una señal de **dominio** (`{ status: 'created' | 'existed', event }`);
el **controller** la mapea a HTTP: `201 Created` (nuevo) / `200 OK` (duplicado, no-op).
HTTP no entra al repository (T3).

El parse del payload es **tolerante** (raw-first): `parseWebhook` valida el sobre y
extrae `externalEventId`/`externalId` sin clasificar el tipo, de modo que un evento
de tipo no soportado igual se persiste (replay). La clasificación estricta vive en
el enrichment (procesamiento).

## Alternatives Considered

### Alternative A: Check-then-insert (SELECT existe? → INSERT en la app)
- **Cómo funciona:** dos statements separados a nivel aplicación.
- **Cons:** gap TOCTOU entre check e insert. Bajo `READ COMMITTED`, dos requests
  concurrentes leen "no existe" y ambos insertan → race (duplicado o 500). El
  happy-path engaña; es incorrecto bajo concurrencia.
- **Por qué no elegida:** la garantía vive en la app, que no puede serializar dos
  conexiones independientes. Es el lost-update del Día 6 disfrazado.

### Alternative B: UNIQUE constraint + catch del unique-violation *(elegida)*
- **Cómo funciona:** un INSERT atómico; el índice único rechaza el duplicado al
  escribir. Check y act fusionados por la DB, sin gap.
- **Pros:** correcto bajo cualquier concurrencia (el índice es la única fuente de
  verdad, sin importar cuántas instancias de la app haya); cero infra nueva; bajo
  overhead.
- **Cons:** hay que atrapar el error específico del driver (Drizzle envuelve el pg
  error; el código vive en `.cause`).

### Alternative C: Lock distribuido (Redis SETNX / Postgres advisory lock)
- **Cómo funciona:** serializa el acceso a la sección de dedup con un lock externo.
- **Pros:** correcto; necesario cuando el invariante cruza recursos sin un constraint
  natural compartido.
- **Cons:** hop de red por request; nuevos modos de falla (lock service caído, TTL
  mal calibrado → split-brain, deadlock); otro sistema que operar. Re-implementa, de
  forma más débil, una garantía que el índice de la DB ya da atómicamente. Además, un
  lock **serializa pero no recuerda**: igual necesitaría una clave persistida → no
  reemplaza al UNIQUE, se sumaría.
- **Por qué no elegida:** la entidad vive en una sola tabla homogénea; agregar una
  capa extra de falla + infra (red/orquestación) no se justifica. Valdría la pena si
  el invariante cruzara múltiples servicios (cada uno dueño de su DB) o si el recurso
  a lockear no fuera siempre un registro de DB (un file/documento).

## Consequences

### Positive
- Idempotencia correcta bajo concurrencia, sin infra adicional.
- La garantía vive en la capa dueña del dato (DB), enforced para cualquier número de
  instancias.
- Raw-first + tolerancia de tipo: ningún evento legítimo se pierde por no soportar su
  tipo todavía (replay desde `payload` jsonb).
- HTTP aislado del repository (T3); errores modelados, ninguno cae en 500 (T5).
- Probado end-to-end: el test "mismo webhook 2 veces → 1 sola fila (`count === 1`) +
  200 en el segundo" es la prueba ejecutable de esta decisión.

### Negative / Trade-offs
- Depende de atrapar un error específico del driver (`error.cause.code === '23505'`),
  acoplamiento a la forma de error de Drizzle/pg.
- El INSERT que falla en el caso duplicado hace trabajo mínimo de más vs un check
  previo (irrelevante a este volumen; un fast-path SELECT opcional podría agregarse,
  pero NO es la guarda).

### Out of scope / Future
- **Colisión de clave (mismo `externalEventId`, payload distinto → 409/422):** no se
  implementa. En webhooks el `externalEventId` lo controla el provider y no lo reusa
  con otro cuerpo; es relevante para idempotency-keys *client-facing* (futuro).
- **Idempotencia de procesamiento (doble Transaction):** decisión separada → Día 8
  (`UNIQUE` en transactions + `processedAt` como filtro).
- **Verificación de firma (HMAC):** requiere los bytes crudos exactos del body; el
  `payload` jsonb re-serializado pierde byte-fidelity → cuando se implemente, guardar
  el body como texto aparte.
- **Migrar guards manuales de provider a Zod schemas** (`z.infer` + `discriminatedUnion`).
