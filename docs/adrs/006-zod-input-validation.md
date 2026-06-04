# 006 — Zod para validación de entrada (input parsing) en la capa HTTP

**Status:** Accepted
**Date:** 2026-06-03
**Authors:** Juan Di Modugno
**Tags:** validation, http, type-safety, parse-dont-validate

## Context

El endpoint `POST /transactions` (y los que sigan) recibe input no confiable que
requiere validación de forma (existencia, tipos) y semántica (reglas de negocio,
ej. `amount > 0`, currency soportada). El proyecto ya adoptó "parse, don't validate"
(ver Día 1, paper de Alexis King) y lo aplicó en el modelo Raw→Enriched de los
providers: la incertidumbre se encapsula en una transición de tipo, no se reparte
como campos opcionales. Además, T1 exige que `amount` nunca sea `number`: entra como
string y se mapea a Money.

El scaffold inicial sugirió class-validator y Zod sin una decisión explícita. Este
ADR toma esa decisión.

## Decision

Usamos **Zod** como librería de validación/parsing de input en la frontera HTTP,
integrada a NestJS vía un `ZodValidationPipe` (propio o `nestjs-zod`). El schema es
la única fuente de verdad: el tipo TS se infiere con `z.infer`, y los `.transform()`
parsean valores crudos a tipos del dominio (ej. `amount` string → Money) dentro del
mismo schema.

## Alternatives Considered

### Alternative A: class-validator + class-transformer (default NestJS)
- **Cómo funciona:** decorators sobre un DTO, aplicados por el ValidationPipe nativo.
- **Pros:** integración nativa, fricción cero, estándar del ecosistema Nest.
- **Cons:** el tipo TS y los decorators se declaran por separado (drift posible);
  valida in-place pero el tipo de salida NO lleva la garantía (rompe parse-don't-validate);
  transform de Money queda fuera, en class-transformer.
- **Por qué no elegida:** incoherente con el principio parse-don't-validate ya adoptado.

### Alternative B: valibot
- **Cómo funciona:** schema-first modular, misma filosofía que Zod, tree-shakeable.
- **Pros:** bundle menor, mismo single-source-of-truth.
- **Cons:** ecosistema/comunidad más chico y nuevo.
- **Por qué no elegida:** para un proyecto de aprendizaje/portfolio, la madurez y el
  soporte de comunidad de Zod pesan más que el ahorro de bundle (no crítico server-side).

### Alternative C: validación a mano / Joi / yup
- **Por qué no elegida:** a mano no escala a semántica; Joi/yup no infieren tipos TS
  con la fidelidad de Zod.

## Consequences

### Positive
- Single source of truth: schema → tipo inferido, sin drift.
- `.transform()` parsea amount→Money en el schema (coherente con T1 y Raw→Enriched).
- Validación coherente con parse-don't-validate: la salida es un tipo con garantía.
- Coherencia de dependencias: al adoptar Zod se removió el `ValidationPipe` global
  de class-validator (`main.ts`) y se desinstalaron `class-validator` y
  `class-transformer` (quedaban del scaffold, sin uso). `reflect-metadata` se
  mantiene: es peer-dependency requerida por NestJS (DI / emitDecoratorMetadata).

### Negative
- Requiere un ZodValidationPipe para integrar con Nest (no es nativo como class-validator).
- Se aparta del camino "oficial" de Nest (menos ejemplos Nest-específicos).

### Risks
- Acoplar Zod a través de muchos handlers si no se aísla el pipe → mitigación: un único
  pipe reutilizable, schemas por módulo.

## When to Revisit
- Si Nest adopta un estándar de validación distinto de forma nativa.
- Si el costo de mantener el pipe/integración supera el beneficio del type-inference.

## References
- ADR-005 (Money representation), ADR-004 (Drizzle)
- "Parse, don't validate" — Alexis King
