# Architecture Decision Records

Decisiones técnicas significativas del proyecto, en orden cronológico.

## Convención

- Numeración: 3 dígitos (`001`, `002`, `010`, `100`)
- Slug: kebab-case (`004-webhook-idempotency`)
- Status: Proposed → Accepted → Deprecated | Superseded by ADR-XXX
- Nunca se borra un ADR. Si cambia, se marca Superseded y se crea otro.

## Cómo escribir uno

1. Lee `../../resources/ADR_GUIDELINE.md` (en la raíz del study-plan)
2. Ejecuta `/assisted-adr <tema>` con el agente coach
3. El agente te guía con preguntas y comparación de opciones
4. Tú eliges, el agente drafta, vos editás
5. Guardás acá con el siguiente número disponible

## ADRs existentes

| # | Título | Status | Fecha |
|---|--------|--------|-------|
| 000 | [Template](./000-template.md) | — | — |
| 001 | [Single repository](./001-single-repository.md) | Accepted | 2026-05-27 |
| 002 | [NestJS framework](./002-nestjs-framework.md) | Accepted | 2026-05-27 |
| 003 | [PostgreSQL over MongoDB](./003-postgres-over-mongo.md) | Accepted | 2026-05-27 |
| 004 | [Drizzle ORM](./004-drizzle-orm.md) | Accepted | 2026-05-30 |
| 005 | [Money representation](./005-money-representation.md) | Accepted | 2026-06-01 |
| 006 | [Zod input validation](./006-zod-input-validation.md) | Accepted | 2026-06-03 |
| 007 | [Webhook idempotency](./007-webhook-idempotency.md) | Accepted | 2026-06-06 |
| 008 | [Webhook processing idempotency](./008-webhook-processing-idempotency.md) | Accepted | 2026-06-08 |
| 009 | [Provider event to domain transaction mapping](./009-provider-event-to-domain-transaction-mapping.md) | Accepted | 2026-06-09 |
| 010 | [Retry & dead-letter strategy (domain-owned)](./010-retry-and-dead-letter-strategy.md) | Accepted | 2026-06-12 |
| 011 | [Dead-letter as domain annex table](./011-dead-letter-domain-annex-table.md) | Accepted | 2026-06-23 |
| 012 | [Observability: structured logging (allowlist) + DB-derived counters](./012-observability-logging-and-metrics.md) | Proposed | 2026-06-25 |

## ADRs anticipados (a escribir durante el roadmap)

Estos son los que vas a escribir cuando lleguen los puntos correspondientes
(numeración tentativa; la real se asigna al escribirlos):

- Reconciliation matching algorithm (semana 5)
- Eventual consistency tradeoffs in reporting (semana 5-6)

No los escribas anticipadamente. Cada uno se escribe cuando llegues al
contexto real donde la decisión se vuelve concreta.
