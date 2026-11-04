CREATE TABLE "maintenance_tickets" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"order_id" uuid,
	"product_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"unit_id" uuid,
	"notes" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_by_user_id" text,
	"closed_at" timestamp with time zone,
	"closed_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maintenance_tickets_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "maintenance_tickets_status" CHECK ("maintenance_tickets"."status" in ('open','closed'))
);
--> statement-breakpoint
ALTER TABLE "maintenance_tickets" ADD CONSTRAINT "maintenance_tickets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_tickets" ADD CONSTRAINT "maintenance_tickets_tenant_id_order_id_orders_tenant_id_id_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."orders"("tenant_id","id") ON DELETE SET NULL ("order_id") ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "maintenance_tickets_number" ON "maintenance_tickets" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "maintenance_tickets_order_idx" ON "maintenance_tickets" USING btree ("tenant_id","order_id");--> statement-breakpoint
SELECT app_enable_tenant_rls('maintenance_tickets'::regclass);
