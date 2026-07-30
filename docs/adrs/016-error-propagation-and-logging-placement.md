# 016 — Error Propagation and Logging Placement in Repositories

**Status:** Accepted
**Date:** 2026-07-30
**Authors:** Juan Di Modugno
**Tags:** error-handling, observability, repositories, T5, d21

## Context

Five `console.error` sites survived in the repository layer (`webhooks.repository.ts`,
`dead-letter.repository.ts`), carried as inherited debt since before ADR-012 introduced
the structured logger. Reviewing them showed they were not one problem but three, and
only the first was an actual T5 violation:

1. **`DeadLetterRepository.append` swallowed the write failure.** It logged and returned
   a clean `void`. The caller (`transitionToManualReview`) then flipped the event to
   `pending_manual_review`. The intended ordering — annex first, state flip second, with
   tests asserting `invocationCallOrder` — only protects if the annex write fails
   *loudly*. Swallowing voided the guarantee: an event could sit in manual review with no
   annex row, i.e. an unauditable failure. It also corrupts `getFailureCountForEvent`,
   whose row count ADR-015 uses as the attempt number.

2. **Two read-side methods collapsed failures into `null`.**
   `getDistinctEventIdCount` and `getEventsInTerminalStatusCountByGroup` caught, logged,
   and returned `null`; `getReconciliationStatus` checked for `null` and answered `200`
   with `{ error: '...' }`. The `null` fused "the read failed" with "I don't know why"
   and dropped the cause entirely — the service could report *that* something broke but
   never *what*.

3. **Two sites logged and re-threw.** T5 was already satisfied; the log was a duplicate
   emitted below the point that decides what the failure means.

All five bypassed the ADR-012 structured logger, and therefore its fail-closed allowlist.

Forces:
- The d21 rule already in use: **log at the domain decision point**, not in infra.
- `Result<T, E>` exists in `src/shared/result` but is documented for *expected domain*
  failures, explicitly not for unexpected ones.
- `/reconciliation-status` is an overseer endpoint: its consumer is monitoring.

## Decision

Three rules, applying to every repository in the project:

1. **Infra does not log what it propagates.** A repository that re-throws does not log.
   Whoever decides what the failure *means* owns the log, using the ADR-012 structured
   logger. Repositories that neither swallow nor decide stay silent.

2. **A failed read is unexpected infrastructure failure, not a domain outcome.**
   "Could not read" is not "read zero". It propagates as an exception carrying its cause.
   It is *not* modeled as `Result<T, E>` — that type stays reserved for failures that are
   expected and part of the domain, per its own documented contract.

3. **The overseer endpoint answers `500` on a failed read**, not `200` with an error
   body. A `200` carrying `{ error }` is counted as success by monitoring: a green that
   lies.

## Alternatives Considered

### Alternative 1: Route all five sites to the structured logger, keep placement

Fixes the ADR-012 bypass and nothing else. Consistent in *channel*.

- ✅ Smallest change; no contract moves.
- ❌ Keeps duplicate logs below the decision point, contradicting d21.
- ❌ The read-side sites have no domain entity to serialize — the logger's
  `(entity, serializer, msg)` shape requires inventing a synthetic serializer with an
  empty allowlist purely to satisfy the signature.

### Alternative 2: Model read failures as `Result<T, E>` (REJECTED)

The error travels as a value to the service, which logs it with its cause and decides.

- ✅ Preserves the cause; consistent with d21; would be the project's first real use of
  `Result`.
- ❌ Contradicts the documented contract of `Result` itself: a Postgres read failure is
  unexpected infrastructure failure, not an expected domain case.
- ❌ Refactor of contract across two repositories, the service, and their tests, to model
  something that is not a domain outcome.

### Alternative 3: Propagate exceptions, silent repositories, 500 at the boundary (CHOSEN)

- ✅ The cause survives, attached to the exception.
- ✅ Infra stays silent; the decision point owns the log (d21).
- ✅ Honest status code — monitoring sees a failure as a failure.
- ✅ Removes a type union and a branch instead of adding machinery.
- ❌ Loses the degraded read: the endpoint no longer answers "here is what I do know".
- ❌ Callers of these repositories must now expect exceptions.

## Trade-off Matrix

| Criterion | Alt 1 (channel only) | Alt 2 (`Result`) | Alt 3 (propagate) |
|---|---|---|---|
| Cause preserved | ✅ | ✅ | ✅ |
| Respects d21 placement | ❌ | ✅ | ✅ |
| Respects `Result`'s own contract | n/a | ❌ | ✅ |
| Honest to monitoring | ❌ (still 200) | ❌ (still 200) | ✅ |
| Code added | none | contract refactor | negative (union + branch removed) |
| Degraded read preserved | ✅ | ✅ | ❌ |

## Consequences

### Positive

- `append` failing can no longer produce an event in manual review with no annex row.
- The reconciliation counters used by ADR-015 stop being silently corruptible from this path.
- No `console.*` remains in production code; nothing bypasses the ADR-012 allowlist.
- `ReconciliationStatus` is no longer a union — one shape, no casting at call sites.

### Negative

- `/reconciliation-status` no longer degrades gracefully. A single failed count query
  fails the whole response.
- A `500` from this endpoint is not yet distinguishable from any other unhandled error.

### Risks

- **Retry duplicates in the annex (bounded, accepted).** With `append` propagating, a
  failure inside `transitionToManualReview` lets BullMQ retry the whole transition
  (`attempts: 3`), so one death can produce up to three annex rows. Extra annex rows are
  acceptable per ADR-011 ("state is reconstructable, the error context is not"), but the
  row count then means "times we recorded a death", not "times it died" — a second
  meaning `getFailureCountForEvent` does not carry honestly. Scheduled for d30: make the
  annex write idempotent per death via a natural-key arbiter (the d26 pattern).
- **The `err` field bypasses the allowlist.** `StructuredLogger` spreads `err` raw into
  the pino payload, outside `getLoggableFields`. ADR-012's fail-closed promise holds for
  the entity and not for the error. Tracked for d30; not introduced by this ADR but
  widened in reach by it, since more errors now travel to the decision point to be logged.

## When to Revisit

- If a caller genuinely needs a partial/degraded read of the overseer lens, revisit
  decision 3 — that would be a domain outcome and `Result<T, E>` would then apply.
- If a repository ever needs to log without deciding (e.g. slow-query telemetry),
  decision 1 needs an explicit exception, not an erosion.

## References

- ADR-011 — dead-letter as append-only domain annex (annex over state)
- ADR-012 — structured logging with fail-closed allowlist
- ADR-015 — dead-letter recovery / reinjection (`getFailureCountForEvent` as attempt number)
- PROJECT_PRINCIPLES T5 — errors are modeled, not ignored
- `src/shared/result/result.ts` — documented scope of `Result<T, E>`
