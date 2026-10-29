ALTER TABLE "orders" ADD COLUMN "discount_note" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "setup_map_file_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "policy_acks" jsonb DEFAULT '{}'::jsonb NOT NULL;