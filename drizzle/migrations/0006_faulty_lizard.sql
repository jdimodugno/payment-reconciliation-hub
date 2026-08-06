-- ADR-011 amendment (d31): a dead-letter row is one DEATH, and two deaths are
-- separated by exactly one reactivation flip. The arbiter is (event_id, generation).
--
-- Written by hand rather than as generated: the generated version was
--   ALTER TABLE ... ADD COLUMN "generation" integer NOT NULL;
-- which fails outright on a non-empty table, and would then hit the UNIQUE with
-- every historical row sitting at the same generation.
--
-- Backfill: historical rows predate the arbiter, so their real generation is
-- unknowable. Numbering them by failure order per event preserves the audit
-- trail as-is (nothing is deleted or merged) and satisfies the constraint. It is
-- a reconstruction, not a measurement.

ALTER TABLE "dead_letter_events" ADD COLUMN "generation" integer;--> statement-breakpoint

UPDATE "dead_letter_events" AS dle
SET "generation" = numbered.rn - 1
FROM (
  SELECT
    "id",
    row_number() OVER (PARTITION BY "eventId" ORDER BY "failedAt", "id") AS rn
  FROM "dead_letter_events"
) AS numbered
WHERE dle."id" = numbered."id";--> statement-breakpoint

ALTER TABLE "dead_letter_events" ALTER COLUMN "generation" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "dead_letter_events" ADD CONSTRAINT "dead_letter_events_event_generation_uk" UNIQUE("eventId","generation");
