CREATE TABLE "invoices" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"order_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"paid_cents" bigint DEFAULT 0 NOT NULL,
	"due_on" date NOT NULL,
	"auto_charge" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"sent_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"last_charge_at" timestamp with time zone,
	"last_charge_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "invoices_number" UNIQUE("tenant_id","number"),
	CONSTRAINT "invoices_kind" CHECK ("invoices"."kind" in ('deposit','balance','full','tip')),
	CONSTRAINT "invoices_status" CHECK ("invoices"."status" in ('open','paid','overdue','void')),
	CONSTRAINT "invoices_amount" CHECK ("invoices"."amount_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "payment_methods" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"gateway" text NOT NULL,
	"gateway_customer_id" text,
	"gateway_method_id" text NOT NULL,
	"brand" text,
	"last4" text,
	"exp_month" integer,
	"exp_year" integer,
	"consent_at" timestamp with time zone NOT NULL,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_methods_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "payment_methods_gateway" UNIQUE("tenant_id","gateway","gateway_method_id"),
	CONSTRAINT "payment_methods_gateway_kind" CHECK ("payment_methods"."gateway" in ('stripe','ipos'))
);
--> statement-breakpoint
CREATE TABLE "signatures" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"agreement_version" text NOT NULL,
	"agreement_text" text NOT NULL,
	"typed_name" text NOT NULL,
	"policies" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"waiver_accepted" boolean,
	"ip" text,
	"user_agent" text,
	"channel" text DEFAULT 'quote_page' NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signatures_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "signatures_channel" CHECK ("signatures"."channel" in ('quote_page','on_site','staff'))
);
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "tip_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "invoice_id" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "gateway" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "gateway_ref" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "card_brand" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "card_last4" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "steps" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_order_id_orders_tenant_id_id_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."orders"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_tenant_id_customer_id_customers_tenant_id_id_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_tenant_id_order_id_orders_tenant_id_id_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."orders"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoices_order_idx" ON "invoices" USING btree ("tenant_id","order_id");--> statement-breakpoint
CREATE INDEX "invoices_due_idx" ON "invoices" USING btree ("tenant_id","status","due_on");--> statement-breakpoint
CREATE INDEX "payment_methods_customer_idx" ON "payment_methods" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "signatures_order_idx" ON "signatures" USING btree ("tenant_id","order_id");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_gateway_ref" UNIQUE("tenant_id","gateway_ref");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_gateway" CHECK ("payments"."gateway" in ('manual','stripe','ipos'));