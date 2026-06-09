# Payment Reconciliation Hub

[![CI](https://github.com/USERNAME/payment-reconciliation-hub/actions/workflows/ci.yml/badge.svg)](https://github.com/USERNAME/payment-reconciliation-hub/actions/workflows/ci.yml)

> Open-source payment reconciliation system. Multi-provider abstraction, idempotent webhooks, and discrepancy reporting.

## What is this?

Fintech platforms integrate multiple payment providers (gateways, banks, processors), each with its own API, webhook format, transaction model, and settlement window. Reconciling internal records against external reports is critical and error-prone.

**Payment Reconciliation Hub** abstracts payment providers behind a unified interface, receives webhooks idempotently with smart retries, reconciles internal vs external transactions, and reports discrepancies.

## Why does this project exist?

This is a learning project for a senior engineer reactivating hands-on coding skills, built openly to demonstrate:

- Idempotent webhook processing
- Multi-provider abstraction patterns
- Async processing with retry strategies
- Reconciliation algorithms
- Production-grade testing and observability

See [docs/adrs/](./docs/adrs/) for architectural decisions and reasoning.

## Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20+ |
| Language | TypeScript (strict) |
| Framework | NestJS — [why?](./docs/adrs/002-nestjs-framework.md) |
| Database | PostgreSQL — [why?](./docs/adrs/003-postgres-over-mongo.md) |
| Queue | BullMQ (Redis) |
| Tests | Jest + Supertest |
| Container | Docker Compose |
| CI/CD | GitHub Actions |

## Quick start

### Prerequisites
- Node.js 20+
- Docker & Docker Compose
- npm or pnpm

### Setup

```bash
# Clone
git clone https://github.com/USERNAME/payment-reconciliation-hub.git
cd payment-reconciliation-hub

# Install dependencies
npm install

# Start infrastructure (Postgres + Redis)
docker-compose up -d

# Run migrations
npm run migration:run

# Start the application
npm run start:dev
```

Application runs at `http://localhost:3000`.
API docs at `http://localhost:3000/api/docs`.

### Testing

```bash
npm run test          # unit tests
npm run test:e2e      # end-to-end
npm run test:cov      # with coverage
```

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  API Gateway                     │
│           (NestJS REST + Swagger)               │
└──────────┬──────────────────────┬────────────────┘
           │                      │
    ┌──────▼──────┐        ┌──────▼──────┐
    │ Transactions│        │  Providers  │
    │   Module    │        │   Module    │
    └──────┬──────┘        └──────┬──────┘
           │                      │
    ┌──────▼──────────────────────▼──────┐
    │      Webhooks Module                │
    │  (receivers, idempotency, retry)    │
    └──────────────┬──────────────────────┘
                   │
            ┌──────▼──────┐
            │   BullMQ    │
            │   Queue     │
            └──────┬──────┘
                   │
    ┌──────────────▼──────────────────────┐
    │     Reconciliation Engine            │
    │  (matching, discrepancies, reports)  │
    └──────────────┬──────────────────────┘
                   │
            ┌──────▼──────┐
            │  PostgreSQL │
            └─────────────┘
```

### Webhook → Transaction flow (idempotent — what's actually built)

> The ASCII above is the target architecture. This is the flow implemented today:
> two idempotency arbiters (reception + processing) and a dead-letter path.

```mermaid
flowchart TD
  P[Provider webhook] -->|POST /webhooks/:providerId| C[WebhookController · thin]
  C --> S1[WebhookService]
  S1 --> R1[WebhookRepository]
  R1 -->|"UNIQUE(providerId, externalEventId)<br/>reception arbiter · ADR-007"| WE[(webhook_events)]
  S1 -. "201 new / 200 duplicate" .-> P

  WE --> PP

  subgraph PP[processPendingEvents · policy + guards]
    direction TB
    G1{"retries ≥ MAX?"} -->|yes| DL
    G1 -->|no| EN["provider.fetchDetails<br/>anti-corruption · ADR-009 layer 1"]
    EN --> G2{"currency soportada?"}
    G2 -->|no| DL
    G2 -->|yes| MAP["event → transaction mapper<br/>ADR-009 layer 2"]
    MAP -->|null| DL
    MAP --> CLAIM["claim atómico + upsert<br/>(misma txn) · ADR-008"]
  end

  CLAIM -->|claim ganado| TX[(transactions)]
  CLAIM -->|"claim perdido (0 filas)"| AP["already_processed · no-op idempotente"]
  CLAIM -->|error real| RT["retries++ · rethrow (T5)"]
  DL["pending_manual_review<br/>dead-letter"]
```

**Por qué dos árbitros:** recepción deduplica el *evento* (UNIQUE); procesamiento garantiza cuántas veces *actúo* sobre él (claim). Un evento único igual puede doble-procesarse sin el claim → ese es el rol de ADR-008.

## Documentation

- [Architecture Decision Records](./docs/adrs/) — why the system is built this way
- [API Documentation](http://localhost:3000/api/docs) — Swagger (run locally)
- [Contributing](./CONTRIBUTING.md) — coming soon

## Project status

🚧 **Work in progress** — early development, not production-ready.

## License

MIT
