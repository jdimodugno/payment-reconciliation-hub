# 017 — Reconciliation imperative shell: ownership, trigger, and observation semantics

- **Status:** Accepted
- **Date:** 2026-08-04
- **Supersedes / amends:** amends ADR-013 (discrepancy row identity)
- **Related:** ADR-013, ADR-014, ADR-015

## Context

The reconciliation engine is complete and tested, but unreachable from production:

```
reconcile()            -> 0 callers  (only its own .spec)
DiscrepancyRepository  -> 0 callers  (only one .e2e)
ReconciliationModule   -> 0 importers other than AppModule
```

`reconciliation.matcher.ts` documents a collaborator that does not exist:

> "Los bordes (imperative shell) cargan y normalizan ambos universos a estas
> formas comparables."

The functional core (ADR-014) is pure and array-testable by design. What is
missing is the shell: the edge that loads both universes, calls the core, and
persists the result. Without it, "the batch produces real discrepancies" is true
only inside a test process.

A separate finding from the same review: `GET /webhooks/reconciliation-status`
does not reconcile anything. It returns webhook pipeline backlog (unprocessed
events with aging, terminal-status counts, dead-lettered count). No provider side,
no comparison, no discrepancy. The name describes an aspiration, not the function.

## Decision

### D1 — The shell lives in `ReconciliationModule`, coupled to a contract

`ReconciliationService` owns the run. It imports `TransactionsModule` and
`WebhooksModule` and depends on their **services**, not their repositories.
`WebhooksModule` exports `WebhookService` (it currently exports nothing);
`WebhookRepository` and `DeadLetterRepository` stay private.

The dependency arrow points `reconciliation -> webhooks`, deliberately: the module
that owns the concept is the one that composes the sources.

### D2 — Manual HTTP trigger now, scheduler later

`POST /reconciliation/runs` exposed by a new controller in `ReconciliationModule`.

`ReconciliationService.run()` must not know who invoked it. The trigger is a door,
not part of the logic — a future cron becomes a second door onto the same method,
with no redesign.

Not chosen now: BullMQ. A queued batch inherits `attempts: 3` + backoff, and
retrying a full scan does not mean what retrying a single webhook means. Deferred
until a run is expensive enough to need durability.

### D3 — Run scope: full scan, explicitly deferred

A run scans everything. This is knowingly wrong at scale and accepted now because
the dataset is small and windowing requires a watermark decision that has no
consumer yet. **Revisit trigger:** the first run whose duration is user-visible,
or the introduction of the cron (D2), whichever comes first.

### D4 — A discrepancy row is an observation, not a problem

This amends ADR-013. The existing arbiter:

```sql
UNIQUE (internalId, providerRef, kind) NULLS NOT DISTINCT
```

was designed for a world where the batch had never run. It makes a conflict mean
one thing — "same state, re-run, converge idempotently". Once the batch runs over
time, a conflict has **two** causes:

- "already seen, unchanged" — dropping it is correct
- "already seen, and it changed" — dropping it is **data loss**

`onConflictDoNothing` treats them identically. Concrete failure: a row detected
Monday (`delta = 10`), marked `resolved` Tuesday, re-diverging Wednesday
(`delta = 5000`). Wednesday's insert conflicts and is silently discarded. The table
reports `resolved / $10` while production is diverging by $5000 right now — and
the batch leaves no trace of having detected it.

Same shape as ADR-015 (`status` fusing arbiter and trigger) and ADR-016 (a
swallowed failure invalidating guarantees built on top). `onConflictDoNothing` is
an empty catch written in SQL.

**Decision:** the row is the observation. The arbiter gains the run dimension
(`runId`), so each run records what it saw. `status` leaves the table: resolution
is a property of the *problem*, and no consumer resolves anything yet (same A1
filter that deferred `find()` and deleted `UNSUPPORTED_CURRENCY`). "What is broken
now?" is answered by the latest observation per `(pair, kind)`.

Not chosen: a two-table problem/observation model. It is the fuller model, but
`status` has no consumer today; building it now is structure without a caller —
the exact debt this ADR exists to repay.

### D6 — An unreadable event is counted, not skipped and not fatal (added during implementation)

Surfaced by the first e2e run, not by design: `findProviderSideEvents` re-enriches
every stored event, and `fetchDetails` throws on anything it cannot parse. A single
malformed event would take down the whole run — and malformed events are not
hypothetical, they are exactly what sits in `pending_manual_review`.

Failing the run is honest but leaves a three-month-old broken event blocking
reconciliation forever. Skipping silently is worse: the pair loses its provider
side, and the matcher reports `missing_provider` — which is false. The provider
did report it; we could not read it.

So the run skips the event and returns `scanned.unreadable`. The count preserves
the distinction ADR-016 already drew for read failures: **"could not read" is not
"read zero"**. A clean run over unreadable data must not read as a healthy one.

The same pass deleted a dead guard: `mapEventToTransaction` cannot return null
after `fetchDetails` has accepted the event, and an unreachable branch reads as a
covered case (the ADR-016 / d29 lesson).

### D5 — Rename the misnamed endpoint

`GET /webhooks/reconciliation-status` is renamed to reflect what it returns
(webhook pipeline backlog), freeing the reconciliation namespace for the real
thing. Public surface change: README/API docs ship in the same PR.

## Alternatives Considered

### D1 Alternative — `ReconciliationService` with its own repository over both tables

Zero module coupling, but two modules reading `webhook_events` duplicates the
source of truth for that schema (the "don't diverge into a parallel copy" lesson).
Rejected: coarse modeling.

### D1 Alternative — shell lives in `webhooks/`

Consistent with where the surfacing already lives, and cheapest today. Rejected:
`reconciliation/` degrades to a library with no identity, and when M2 replaces the
provider side with a real API, the shell sits in the module that change makes
irrelevant.

### D1 Alternative — export `WebhookRepository` instead of `WebhookService`

Rejected: couples `reconciliation/` to another module's persistence schema (T3).
Contract over table.

## Trade-off Matrix

| Dimension | D1 (i) contract | D1 (ii) own repo | D1 (iii) shell in webhooks |
|---|---|---|---|
| Module coupling | one arrow, explicit | none | none |
| Schema ownership | preserved | **violated** | preserved |
| Cost of M2 (real provider API) | one injection | one injection | shell must move |
| Conceptual honesty | module owns its concept | ok | name lies twice |
| Work today | export + wire | new repo | least |

## Consequences

### Positive

- The engine becomes reachable: M1 is demonstrable end-to-end, not only in tests.
- `find()` gets the consumer its docstring has been waiting for.
- M2 (real provider API) becomes a one-injection change.
- Re-detection after resolution stops being silently discarded.

### Negative

- Migration on `discrepancies`: new `runId`, arbiter changed, `status` dropped.
- "What is broken now?" becomes a query (latest observation per pair+kind), not a
  table scan of `status = 'unresolved'`.
- Full scan per run is accepted debt (D3).

### Risks

- Row growth is now per-run, not per-problem. Bounded today by dataset size;
  becomes real with the cron.
- Renaming a public route breaks any existing consumer. Acceptable: there are none.

## When to Revisit

- **D3 (scope):** first user-visible run duration, or when the cron lands.
- **D2 (trigger):** when a run becomes expensive enough to need durability/retry.
- **D4 (status):** when a consumer that actually resolves discrepancies exists —
  that is when the problem/observation split earns its migration.

## References

- ADR-013 — discrepancy modeling (amended here: row identity)
- ADR-014 — matching strategy: re-derive, don't trust
- ADR-015 — the `status` field that fused two predicates
- ADR-016 — a swallowed failure invalidates guarantees built on top
