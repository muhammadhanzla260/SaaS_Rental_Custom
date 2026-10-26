CREATE TABLE "ops_snoozes" (
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"rule" text NOT NULL,
	"until" timestamp with time zone NOT NULL,
	"reason" text,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ops_snoozes_tenant_id_order_id_rule_pk" PRIMARY KEY("tenant_id","order_id","rule"),
	CONSTRAINT "ops_snoozes_rule" CHECK ("ops_snoozes"."rule" in ('deposit','final_payment','call','contact','quote'))
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "pre_event_called_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ops_snoozes" ADD CONSTRAINT "ops_snoozes_tenant_id_order_id_orders_tenant_id_id_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."orders"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
SELECT app_enable_tenant_rls('ops_snoozes'::regclass);
