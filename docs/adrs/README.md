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

## ADRs anticipados (a escribir durante el roadmap)

Estos son los que vas a escribir cuando lleguen los puntos correspondientes:

- **004** — Money representation strategy (semana 1-2, antes de implementar Money)
- **005** — ORM choice: Prisma vs TypeORM (semana 1-2, antes de la primera migration)
- **006** — Webhook idempotency strategy (semana 2-3, antes de implementar receivers)
- **007** — Retry policy and dead letter queue (semana 3-4)
- **008** — Reconciliation matching algorithm (semana 5)
- **009** — Eventual consistency tradeoffs in reporting (semana 5-6)

No los escribas anticipadamente. Cada uno se escribe cuando llegues al
contexto real donde la decisión se vuelve concreta.
