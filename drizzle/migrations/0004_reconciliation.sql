CREATE TYPE "public"."discrepancyKind" AS ENUM('amount_mismatch', 'state_mismatch', 'missing_internal', 'missing_provider');--> statement-breakpoint
CREATE TYPE "public"."discrepancyStatus" AS ENUM('unresolved', 'resolved', 'dismissed');--> statement-breakpoint
CREATE TABLE "discrepancies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "discrepancyKind" NOT NULL,
	"internalId" uuid,
	"providerRef" varchar,
	"delta" numeric(38, 18),
	"status" "discrepancyStatus" DEFAULT 'unresolved' NOT NULL,
	"detectedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb NOT NULL
);
