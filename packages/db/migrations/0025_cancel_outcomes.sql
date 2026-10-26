CREATE TABLE "refunds" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"order_id" uuid NOT NULL,
	"payment_id" uuid,
	"amount_cents" bigint NOT NULL,
	"method" text NOT NULL,
	"gateway" text DEFAULT 'manual' NOT NULL,
	"gateway_ref" text,
	"reason" text,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "refunds_number" UNIQUE("tenant_id","number"),
	CONSTRAINT "refunds_amount" CHECK ("refunds"."amount_cents" > 0),
	CONSTRAINT "refunds_gateway" CHECK ("refunds"."gateway" in ('manual','stripe','ipos'))
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cancel_outcome" text;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_tenant_id_order_id_orders_tenant_id_id_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."orders"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "refunds_order_idx" ON "refunds" USING btree ("tenant_id","order_id");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_cancel_outcome" CHECK ("orders"."cancel_outcome" is null or "orders"."cancel_outcome" in ('none','wallet','refund','rain_check'));--> statement-breakpoint
-- Phase 3: refunds are records like payments: isolated per workspace, never rewritten.
SELECT app_enable_tenant_rls('refunds'::regclass);
--> statement-breakpoint
REVOKE UPDATE, DELETE ON refunds FROM rental_app;
