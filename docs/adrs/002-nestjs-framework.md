# 002 — NestJS as the backend framework

**Status:** Accepted
**Date:** 2026-05-27
**Authors:** Juan Di Modugno
**Tags:** backend, framework

## Context

The project needs an HTTP framework for the backend. The choice shapes
nearly everything: structure, testability, dependency injection, middleware
patterns, learning curve for newcomers.

Constraints:
- TypeScript-first (out of the box, not bolted on)
- Suitable for a long-running service with multiple modules
- Active ecosystem (we'll integrate Swagger, BullMQ, validation, etc.)
- Author has prior NestJS experience from freelance work
- Author is interviewing for senior backend roles where this choice matters

The framework choice will be visible in interview portfolio reviews.
"Why NestJS over X" will be asked.

## Decision

Use **NestJS 10+** as the backend framework.

Embrace its opinionated structure: modules, providers, dependency injection,
guards, interceptors, pipes. Do NOT fight the framework's patterns; if a
NestJS-idiomatic solution exists, use it.

## Alternatives Considered

### Alternative A: Express + custom structure
- **Cómo funciona:** Minimal HTTP framework. We build module structure,
  DI, validation, etc.
- **Pros:** Maximum flexibility. No opinion to fight. Wide community.
  Familiar to all Node devs.
- **Cons:** We end up building a worse NestJS. No structure means
  every new dev re-learns "where things go". Testing is harder without
  built-in DI.
- **Por qué no elegida:** The cost of building/maintaining custom structure
  outweighs the flexibility benefit. We are NOT a framework team.

### Alternative B: Fastify (raw)
- **Cómo funciona:** Modern, faster alternative to Express. Same minimal
  philosophy.
- **Pros:** Higher throughput than Express. Better TypeScript support.
  Schema-based validation built in.
- **Cons:** Same structural problem as Express. Smaller ecosystem.
- **Por qué no elegida:** Performance is not our bottleneck. The structural
  argument against raw Express applies equally here.

### Alternative C: Hono
- **Cómo funciona:** Very modern, lightweight, edge-runtime-friendly.
- **Pros:** Excellent DX. Tiny bundle. Modern from the ground up.
- **Cons:** Young ecosystem. Few production references. Author has no
  experience with it.
- **Por qué no elegida:** Interesting but the learning curve plus ecosystem
  immaturity is not worth it for a project that aims to demonstrate
  production-ready patterns. Save for a future toy project.

### Alternative D: Spring Boot (Java)
- **Cómo funciona:** Equivalent ecosystem in JVM.
- **Pros:** Author has recent Java + Spring experience at Buenbit. Highly
  relevant to fintech roles.
- **Cons:** Decided early to optimize for Node/TS market (broader job pool
  in LATAM remote). Mixing stacks dilutes the project's narrative.
- **Por qué no elegida:** Scope discipline. Java skills are kept warm
  separately, not in this project.

## Trade-off Matrix

| Criterion | NestJS | Express | Fastify | Hono |
|-----------|--------|---------|---------|------|
| Structure out of box | ✅✅ | ❌ | ❌ | ❌ |
| DI built-in | ✅✅ | ❌ | ❌ | ❌ |
| TypeScript first-class | ✅ | ⚠️ | ✅ | ✅✅ |
| Testing utilities | ✅✅ | ❌ | ⚠️ | ⚠️ |
| Author experience | ✅ | ✅ | ❌ | ❌ |
| Ecosystem maturity | ✅ | ✅✅ | ✅ | ⚠️ |
| Learning curve | ⚠️ | ✅✅ | ✅ | ✅ |

## Consequences

### Positive
- Clear structure: modules, controllers, services, repositories
- Dependency injection makes testing straightforward
- Built-in support for what we need: Swagger, validation, guards
- Patterns enforce PRINCIPLE T3 (controllers thin, services pure)
  almost automatically
- Documented interview answer to "how do you structure backends?"

### Negative
- Heavier than alternatives (more decorators, more abstractions)
- "Magic" of DI requires understanding to debug
- Opinionated structure can feel constraining for unusual designs
- Boot time slower than raw Express/Fastify

### Risks
- **Risk:** Decorators and DI may obscure what's happening when bugs occur.
- **Mitigation:** Maintain familiarity with the underlying Express layer.
  Read NestJS source for one module per month.

- **Risk:** Lock-in. Migrating away later is expensive.
- **Mitigation:** Keep domain logic in services that don't import NestJS
  types. PRINCIPLE T3 helps here.

## When to Revisit

- If startup time becomes a deployment issue (cold starts on serverless)
- If the abstraction starts costing more than it saves
- If a major NestJS version migration becomes painful enough to consider
  rewriting

## References

- [NestJS official docs](https://docs.nestjs.com/)
- [NestJS vs Express benchmarks](https://github.com/fastify/benchmarks)
- ADR-001: Single repository
