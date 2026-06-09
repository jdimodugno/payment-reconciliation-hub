ALTER TABLE "webhook_events" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "webhook_events" ALTER COLUMN "status" SET DEFAULT 'received'::text;--> statement-breakpoint
DROP TYPE "public"."webhookEventStatus";--> statement-breakpoint
CREATE TYPE "public"."webhookEventStatus" AS ENUM('received', 'processed', 'pending_manual_review');--> statement-breakpoint
ALTER TABLE "webhook_events" ALTER COLUMN "status" SET DEFAULT 'received'::"public"."webhookEventStatus";--> statement-breakpoint
ALTER TABLE "webhook_events" ALTER COLUMN "status" SET DATA TYPE "public"."webhookEventStatus" USING "status"::"public"."webhookEventStatus";--> statement-breakpoint
ALTER TABLE "webhook_events" ADD COLUMN "reason" varchar(30);