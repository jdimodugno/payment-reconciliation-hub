# 003 — PostgreSQL over MongoDB for primary data store

**Status:** Accepted
**Date:** 2026-05-27
**Authors:** Juan Di Modugno
**Tags:** data, infra

## Context

The system stores financial transactions, reconciliation batches, discrepancies,
and webhook events. These are the core data the entire system operates on.

Properties of this data:
- Strongly relational (transactions belong to providers, discrepancies
  reference both internal and external transactions)
- ACID required (we cannot have partial writes during reconciliation)
- Auditable (financial data must be queryable for compliance scenarios)
- Schema is well-known upfront (we model the domain, not unknown JSON)
- Read patterns include joins (matching, reporting)

The decision is foundational and very hard to reverse once data accumulates.

## Decision

Use **PostgreSQL 16+** as the primary data store.

All transactional data lives here. If we need ephemeral storage for queues
or caching, that's Redis (see BullMQ choice). If we need search later,
add a search index that's a derived view of Postgres.

## Alternatives Considered

### Alternative A: MongoDB
- **Cómo funciona:** Document database, schema-flexible, horizontal scaling first-class.
- **Pros:** Easy to start with unstructured webhook payloads (just store
  the JSON). Schema evolution is permissive.
- **Cons:** Transactions across documents are second-class. Joins are
  expensive or impossible. Financial data with referential integrity is
  awkward.
- **Por qué no elegida:** The "schema flexibility" advantage is exactly
  the wrong tradeoff for financial data. We WANT strict schemas. Referential
  integrity isn't optional for reconciliation. ACID isn't optional for money.

### Alternative B: MySQL / MariaDB
- **Cómo funciona:** Other major relational option.
- **Pros:** Similar ACID guarantees. Wide adoption.
- **Cons:** Weaker JSON support than Postgres. Less rich type system
  (no native UUID, weaker timestamp handling). Replication semantics
  are murkier.
- **Por qué no elegida:** Postgres is strictly more capable for our case.
  No upside to MySQL here.

### Alternative C: SQLite (for development) + Postgres (for prod)
- **Cómo funciona:** Use lightweight SQLite locally, real Postgres in prod.
- **Pros:** Zero local infra.
- **Cons:** Dev/prod divergence. SQL dialect differences. Concurrency
  semantics different. Bugs that don't appear locally appear in prod.
- **Por qué no elegida:** Docker Compose gives us real Postgres locally
  with zero ceremony. Dev/prod parity is worth the 30s docker-compose up.

### Alternative D: CockroachDB
- **Cómo funciona:** Postgres-compatible distributed SQL.
- **Pros:** Built-in horizontal scaling. Same SQL as Postgres.
- **Cons:** Operational complexity. Not needed at our scale. Adds latency.
- **Por qué no elegida:** Premature optimization. Single-node Postgres
  serves billions of rows.

## Consequences

### Positive
- Strong consistency guarantees (foundational for financial data)
- Rich query language (joins, window functions, CTEs) helps reconciliation
- Mature ecosystem (Prisma, TypeORM, Knex all first-class)
- JSON columns for cases where flexibility IS needed (raw webhook payloads)
- Author has years of Postgres experience

### Negative
- Vertical scaling has limits (eventually we'd need sharding)
- Migration discipline required from day one
- Schema changes need migrations, not just code changes

### Risks
- **Risk:** Schema migrations become painful as data grows.
- **Mitigation:** Use a real migration tool from day one. Test migrations
  in CI on a snapshot of production-like data.

- **Risk:** Hot rows (e.g., per-provider event counter) become contention points.
- **Mitigation:** Avoid such patterns. Use append-only event tables instead
  of mutable counters. Compute aggregates async.

## When to Revisit

- If write throughput per single node consistently exceeds 10K writes/sec
- If we need true multi-region active-active (not common at this stage)
- If we add legitimate document-shaped data that doesn't fit relational
  modeling (then add a complementary store, don't replace Postgres)

## References

- [Postgres vs MySQL](https://www.postgresql.org/about/featurematrix/)
- [Why Stripe uses MongoDB](https://stripe.com/blog/online-migrations) —
  context: this is for specific use cases, not their core ledger.
  Their ledger is a custom event store, not Mongo.
- ADR-002: NestJS framework
