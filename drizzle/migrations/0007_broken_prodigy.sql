-- ADR-017 D4: a discrepancy row is an OBSERVATION of one run, not a mutable problem.
--
-- Hand-edited after generation: `ADD COLUMN "runId" uuid NOT NULL` fails outright
-- on a non-empty table. Existing rows predate the concept of a run, so they are
-- backfilled into a single synthetic run — they were all observed by "whatever
-- ran before runs existed", and inventing a distinct runId per row would claim a
-- history that was never recorded.
--
-- The old arbiter is dropped BEFORE the backfill: with (internalId, providerRef,
-- kind) still in place the data already satisfies the narrower key, so a shared
-- runId cannot collide under the new one.

ALTER TABLE "discrepancies" DROP CONSTRAINT "discrepancies_pair_kind_uk";--> statement-breakpoint

ALTER TABLE "discrepancies" ADD COLUMN "runId" uuid;--> statement-breakpoint

UPDATE "discrepancies"
SET "runId" = '00000000-0000-0000-0000-000000000000'
WHERE "runId" IS NULL;--> statement-breakpoint

ALTER TABLE "discrepancies" ALTER COLUMN "runId" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "discrepancies" ADD CONSTRAINT "discrepancies_run_pair_kind_uk" UNIQUE NULLS NOT DISTINCT("runId","internalId","providerRef","kind");
