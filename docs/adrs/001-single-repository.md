# 001 — Single repository (monorepo not justified yet)

**Status:** Accepted
**Date:** 2026-05-27
**Authors:** Juan Di Modugno
**Tags:** infra, project-structure

## Context

This project starts as a single backend service with potentially a minimal
frontend dashboard later (semana 6). We need to decide upfront how to
structure the repository: single repo, monorepo with tooling (Nx, Turborepo,
pnpm workspaces), or multiple repos.

The decision is foundational: changing later involves history rewriting
and tooling migration.

Constraints:
- Solo developer (one author)
- Learning project, not production
- May grow to include: frontend dashboard, CLI tool, shared types
- Should not introduce tooling complexity unjustified by current scope

## Decision

Use a **single repository, single package**. No monorepo tooling.

The frontend dashboard (semana 6) will live in `apps/dashboard/` if needed,
sharing types through `src/shared/types/` exported as a local module path.
If this becomes painful, promote to pnpm workspaces.

## Alternatives Considered

### Alternative A: Monorepo with Nx
- **Cómo funciona:** Nx orchestrates multiple packages, provides caching,
  task graph, code generators.
- **Pros:** Industry standard for large TS projects. Great DX once configured.
  Excellent caching saves time at scale.
- **Cons:** Significant upfront complexity. Learning curve. Configuration
  files explode in number.
- **Por qué no elegida:** Solo dev + 1-2 packages = ROI negative. The
  cognitive overhead exceeds the benefit at this scale.

### Alternative B: pnpm workspaces
- **Cómo funciona:** Lightweight monorepo via pnpm's native workspace feature.
- **Pros:** Minimal tooling, gets us most of monorepo benefits.
- **Cons:** Still requires upfront structure decisions, multiple package.jsons,
  cross-package imports.
- **Por qué no elegida:** Premature for current scope. Easy to migrate to
  later if needed.

### Alternative C: Multiple repositories (one per service)
- **Cómo funciona:** Backend in one repo, future dashboard in another, etc.
- **Pros:** Maximum isolation. Independent CI/CD per repo.
- **Cons:** Type sharing requires publishing packages. Cross-cutting changes
  require multiple PRs. Discovery cost for newcomers.
- **Por qué no elegida:** Massive friction for a solo dev. Type duplication
  inevitable.

## Consequences

### Positive
- Zero tooling overhead — `npm install` and go
- All code visible in one place — easy navigation
- Single CI pipeline — simple to reason about
- No package versioning headaches

### Negative
- Future split into multiple deployable units requires restructuring
- Type sharing across boundaries (if added later) needs migration
- No per-package independent dependencies (everything shares one
  `node_modules`)

### Risks
- **Risk:** If the project grows beyond ~3 logical units, refactoring may hurt.
- **Mitigation:** Watch for friction signals. Migration to pnpm workspaces is
  ~1 day of work and reversible.

## When to Revisit

- When adding a second deployable artifact (e.g., CLI, separate worker service)
- When the team grows to >2 people working on isolated areas
- When CI times exceed 5 minutes consistently

## References

- [Monorepo Tools comparison](https://monorepo.tools/)
- [The pros and cons of monorepos](https://kinsta.com/blog/monorepo-vs-multi-repo/)
