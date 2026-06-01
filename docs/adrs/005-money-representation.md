# 005 — Money representation: numeric storage + decimal.js in memory

**Status:** Accepted
**Date:** 2026-06-01
**Authors:** Juan Di Modugno
**Tags:** domain, data, money

## Context

Every monetary amount in the system (`Transaction.amount`, batch totals,
discrepancy deltas) needs a representation that is **exact** — IEEE 754 floats
are forbidden (principle T1: `0.1 + 0.2 !== 0.3`, unacceptable for regulated
fintech).

Two things make this non-trivial here:

- **Multi-currency, including crypto.** The system handles fiat (ARS, USD —
  2 decimals) and crypto (BTC — 8 decimals / satoshis). The smallest-unit scale
  differs per currency, and that drives the design.
- **The matching/reconciliation engine aggregates amounts in SQL** (sums per
  batch, internal-vs-external comparison). The storage representation must be
  exact *and* queryable.

A key realization: **storage and computation are two separate decisions**, not
one. How an amount is stored in Postgres and how it is represented/operated in
memory can differ, as long as the round-trip is lossless.

A `Money` value object already exists (`src/shared/money`) but is intentionally
incomplete and tentatively backed by `bigint` cents — the scaffold explicitly
defers to this ADR before completion.

## Decision

- **Storage:** Postgres `numeric(38, 18)` column. Exact decimal, arbitrary
  enough for 8-decimal crypto plus headroom for intermediate rate math.
- **In memory:** a `Money` value object backed by **decimal.js**. The library
  is fully encapsulated inside `Money`; no other module imports it (principle
  T3 — if we swap the library later, only `Money` changes).
- **Never** `number`/float anywhere in a monetary path.
- `node-postgres`/Drizzle return `numeric` as a **string** (precisely to avoid
  float coercion). Amounts are **always** hydrated into `Money` on read and
  never exposed raw — this is what keeps an accidental `Number(amount)` from
  reintroducing the float T1 forbids.

Rationale: `numeric` is an exact, SQL-aggregable, human-readable source of
truth, which the matching engine needs; `Money`-over-decimal.js gives ergonomic,
exact computation in app code; and if the source of truth is healthy everything
else can be reconstructed, which keeps any future migration cheap.

## Alternatives Considered

### Alternative A: bigint smallest-unit, both in storage and memory
- **Cómo funciona:** store `bigint` cents/satoshis + `currency`; operate with bigint.
- **Pros:** exact; fast integer math; what the Money scaffold tentatively chose.
- **Cons:** scale is **implicit** — a bare `bigint` doesn't say whether it's
  cents (USD) or satoshis (BTC); summing across scales in SQL is meaningless
  without normalization, so aggregation moves to app code.
- **Por qué no elegida:** the matching engine wants SQL aggregation and a
  readable source of truth; implicit scale is a footgun for a multi-currency
  ledger.

### Alternative C: numeric storage + bigint smallest-unit in memory
- **Cómo funciona:** `numeric` column, but app converts to `bigint` smallest-unit.
- **Pros:** readable/aggregable DB; exact integer math in app.
- **Cons:** still carries implicit-scale handling in memory; conversions
  (rates, division) are awkward with integers.
- **Por qué no elegida:** keeps the scale footgun in app code without the
  ergonomic upside of a decimal library for conversion math.

### Alternative D: string decimal storage + decimal library
- **Cómo funciona:** store amounts as `text`, parse on read.
- **Pros:** no numeric coercion at the driver level.
- **Cons:** no native SQL arithmetic or correct ordering; every aggregation
  becomes app-side; parsing discipline required everywhere.
- **Por qué no elegida:** loses SQL aggregation, which the matching engine
  depends on.

> `number`/float is not listed: it is excluded by principle T1 before any
> trade-off (see day-1 learning `no_false_positive_health` / `parse_dont_validate`).

## Consequences

### Positive
- Exact monetary values end-to-end; no float anywhere.
- DB is an aggregable, human-readable source of truth — the matching engine can
  sum/compare in SQL.
- decimal.js gives ergonomic exact arithmetic for conversions and fees.
- Future migration is cheap: a healthy `numeric` source reconstructs everything.
- The library is encapsulated in `Money` (T3) — swappable without ripple.

### Negative
- Adds a runtime dependency (decimal.js).
- Requires reworking the existing `Money` VO from its tentative `bigint` cents
  backing to a decimal.js backing.
- `precision`/`scale` must be chosen explicitly (`numeric(38, 18)`), not left
  implicit.

### Risks
- **Risk:** someone does `Number(amount)` on the string returned for a `numeric`
  column and reintroduces float error.
- **Mitigation:** amounts are always hydrated to `Money` on read; raw strings
  never leave the repository layer. Consider a lint rule / code-review check.

- **Risk:** decimal.js misuse (constructing a Decimal from a float literal).
- **Mitigation:** `Money` factories accept strings/Decimal only, never `number`.

## When to Revisit
- If a currency with a scale beyond 18 decimals is added (revisit `numeric` scale).
- If profiling shows decimal.js arithmetic is a hot-path bottleneck (consider
  bigint smallest-unit for inner loops, keeping numeric storage).
- If we ever need cross-currency stored totals (forces an explicit normalization
  / FX decision).

## References
- ADR-003: PostgreSQL over MongoDB
- ADR-004: Drizzle ORM
- Principle T1: Money is never `number`
- [decimal.js](https://mikemcl.github.io/decimal.js/)
