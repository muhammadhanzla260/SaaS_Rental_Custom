ALTER TABLE "payment_accounts" DROP CONSTRAINT "payment_accounts_provider";--> statement-breakpoint
ALTER TABLE "payment_accounts" ALTER COLUMN "provider" SET DEFAULT 'manual';--> statement-breakpoint
ALTER TABLE "payment_accounts" ADD COLUMN "merchant_id" text;--> statement-breakpoint
UPDATE "payment_accounts" SET "provider" = 'manual' WHERE "provider" = 'none';--> statement-breakpoint
ALTER TABLE "payment_accounts" ADD CONSTRAINT "payment_accounts_provider" CHECK ("payment_accounts"."provider" in ('manual','stripe','ipos'));