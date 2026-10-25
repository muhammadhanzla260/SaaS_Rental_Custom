CREATE TABLE "message_templates" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"channel" text NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"button_text" text DEFAULT '' NOT NULL,
	"mode" text DEFAULT 'builder' NOT NULL,
	"raw_source" text DEFAULT '' NOT NULL,
	"raw_kind" text DEFAULT 'html' NOT NULL,
	"attach_document" boolean DEFAULT false NOT NULL,
	"attach_agreement" boolean DEFAULT false NOT NULL,
	"tracking" boolean DEFAULT false NOT NULL,
	"auto_plain_text" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_templates_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "message_templates_type" UNIQUE("tenant_id","type","channel"),
	CONSTRAINT "message_templates_channel" CHECK ("message_templates"."channel" in ('email','sms')),
	CONSTRAINT "message_templates_mode" CHECK ("message_templates"."mode" in ('builder','raw'))
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"idempotency_key" text NOT NULL,
	"order_id" uuid,
	"location_id" uuid,
	"type" text NOT NULL,
	"channel" text NOT NULL,
	"audience" text DEFAULT 'customer' NOT NULL,
	"to_address" text,
	"to_name" text,
	"subject" text,
	"html" text,
	"text" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"scheduled_for" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"provider_ref" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "messages_idempotency" UNIQUE("tenant_id","idempotency_key"),
	CONSTRAINT "messages_channel" CHECK ("messages"."channel" in ('email','sms')),
	CONSTRAINT "messages_status" CHECK ("messages"."status" in ('queued','sending','sent','delivered','bounced','failed','skipped','cancelled'))
);
--> statement-breakpoint
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_id_order_id_orders_tenant_id_id_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."orders"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_due_idx" ON "messages" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE INDEX "messages_order_idx" ON "messages" USING btree ("tenant_id","order_id");--> statement-breakpoint
CREATE INDEX "messages_log_idx" ON "messages" USING btree ("tenant_id","created_at");