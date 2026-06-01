# 004 — Drizzle ORM over Prisma/TypeORM for the data access layer

**Status:** Accepted
**Date:** 2026-05-30
**Authors:** Juan Di Modugno
**Tags:** data, infra

## Context

PostgreSQL is already the primary data store (see ADR-003). We now need a data
access layer to model and query it.

The core domain entities are `Transaction`, `Provider`, and `WebhookEvent`.
The heart of the system is **reconciliation**: matching internal transactions
against external provider events. That matching is non-trivial query work
(joins, aggregations, set differences), not simple CRUD.

The forces that drive this decision:
- **Migrations** weigh most: we need a reliable, auditable migration history so
  any schema change is traceable when revisiting an incident.
- **Modeling** expressiveness for the domain entities and their relations.
- **Query capability for the matching** logic, without being pushed out to raw
  SQL escape hatches for anything non-trivial.
- Type-safety and didactic value are *not* differentiators — any modern option
  delivers them, and this project is a learning vehicle regardless of the tool.

This project is time-boxed (8 weeks) and single-author; the author must
understand the whole stack.

## Decision

Use **Drizzle ORM** as the data access layer.

Drizzle is the only option that scores high on *both* primary drivers
(migrations and matching queries) without forcing a raw-SQL escape hatch like
Prisma, nor hand-written migrations like a pure query builder. As a side
benefit it introduces a technology the author has not used, which suits the
didactic character of the project.

## Alternatives Considered

### Alternative A: Prisma
- **Cómo funciona:** Declarative `schema.prisma`, generated type-safe client.
- **Pros:** Best-in-class migrations (declare desired state, generates the diff).
  Excellent DX and free type-safety. Author already has experience with it.
- **Cons:** Complex queries push you to `$queryRaw` — exactly where this project
  lives (matching). Modeling is limited (weaker enums/polymorphism).
- **Por qué no elegida:** Strongest where it matters least here (CRUD/DX) and
  weakest where it matters most (matching queries). Prior familiarity is not a
  valid decision driver.

### Alternative B: TypeORM
- **Cómo funciona:** Decorator-based entities, Active Record / Data Mapper, QueryBuilder.
- **Pros:** Very expressive modeling (inheritance, rich relations). QueryBuilder
  sits closer to SQL. Idiomatic fit with NestJS.
- **Cons:** Migrations are more manual and fragile. Reputation for irregular
  maintenance and rough edges.
- **Por qué no elegida:** Weak on the top driver (migrations), and its modeling
  edge does not outweigh that.

### Alternative C: Kysely
- **Cómo funciona:** Pure type-safe query builder — SQL, not an ORM.
- **Pros:** Total control over queries (ideal for matching). Most didactic
  option: forces SQL-level thinking.
- **Cons:** Migrations are written by hand. More boilerplate. No entity
  abstraction.
- **Por qué no elegida:** Loses the top driver (migrations are manual). The
  control upside is real but not worth giving up migration ergonomics.

## Consequences

### Positive
- Both primary drivers covered: solid migrations (`drizzle-kit`) and SQL-thin
  queries that handle the matching logic well.
- Full type-safety from a SQL-like schema defined in TypeScript.
- Author learns a new, modern technology — aligned with the project's purpose.

### Negative
- Smaller ecosystem/maturity than Prisma or TypeORM — fewer answers available,
  possible rough edges.
- Learning curve with zero prior experience, in a time-boxed project. Prisma
  could have been running today.

### Risks
- **Risk:** A Drizzle rough edge or missing feature blocks progress mid-project.
- **Mitigation:** Postgres is the constant (ADR-003); Drizzle is thin over SQL,
  so dropping to raw SQL through Drizzle is cheap if needed. The blast radius of
  switching is contained to services/providers.

- **Risk:** Time lost to the learning curve compresses other blocks.
- **Mitigation:** Accepted consciously — the time trade-off is affordable given
  the didactic character of the project.

## When to Revisit
- If a Drizzle limitation repeatedly forces awkward workarounds in the matching
  queries.
- If the ecosystem gap costs materially more debugging time than the learning
  value returns.
- If the project ever needs a second engineer unfamiliar with Drizzle (team
  familiarity becomes a new driver).

## References
- ADR-003: PostgreSQL over MongoDB
- [Drizzle ORM docs](https://orm.drizzle.team/)
