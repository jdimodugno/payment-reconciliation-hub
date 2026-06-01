CREATE TYPE "public"."transactionStatus" AS ENUM('pending', 'settled', 'failed', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."transactionType" AS ENUM('payin', 'payout');--> statement-breakpoint
CREATE TABLE "providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar NOT NULL,
	"type" varchar NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "providers_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"externalId" varchar NOT NULL,
	"providerId" uuid NOT NULL,
	"amount" numeric(38, 18) NOT NULL,
	"currency" varchar(8) NOT NULL,
	"status" "transactionStatus" NOT NULL,
	"type" "transactionType" NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb,
	CONSTRAINT "transactions_provider_external_uq" UNIQUE("providerId","externalId")
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_providerId_providers_id_fk" FOREIGN KEY ("providerId") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;