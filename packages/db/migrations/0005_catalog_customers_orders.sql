CREATE TABLE "customers" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"kind" text DEFAULT 'individual' NOT NULL,
	"first_name" text,
	"last_name" text,
	"company_name" text,
	"display_name" text GENERATED ALWAYS AS (coalesce(nullif(trim(coalesce(first_name,'') || ' ' || coalesce(last_name,'')), ''), company_name, 'Unnamed')) STORED,
	"email" "citext",
	"phone" text,
	"phone_secondary" text,
	"line1" text,
	"line2" text,
	"city" text,
	"region" text,
	"postal_code" text,
	"country" text DEFAULT 'US' NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"source" text,
	"notes" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"sms_opt_in" boolean DEFAULT true NOT NULL,
	"tax_exempt" boolean DEFAULT false NOT NULL,
	"external_refs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "customers_kind" CHECK ("customers"."kind" in ('individual','organization'))
);
--> statement-breakpoint
CREATE TABLE "inventory_pools" (
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"quantity_owned" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "inventory_pools_tenant_id_product_id_location_id_pk" PRIMARY KEY("tenant_id","product_id","location_id"),
	CONSTRAINT "inventory_pools_qty" CHECK ("inventory_pools"."quantity_owned" >= 0)
);
--> statement-breakpoint
CREATE TABLE "order_lines" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"name" text NOT NULL,
	"service_mode" text DEFAULT 'staffed' NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_cents" bigint NOT NULL,
	"auto_unit_cents" bigint NOT NULL,
	"price_overridden" boolean DEFAULT false NOT NULL,
	"flat_rate" boolean DEFAULT false NOT NULL,
	"setup_surface" text,
	"setup_surface_fee_cents" bigint DEFAULT 0 NOT NULL,
	"line_total_cents" bigint NOT NULL,
	"pricing_trace" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "order_lines_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "order_lines_mode" CHECK ("order_lines"."service_mode" in ('staffed','pickup','dropoff')),
	CONSTRAINT "order_lines_qty" CHECK ("order_lines"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"location_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"event_type" text,
	"event_starts_at" timestamp with time zone NOT NULL,
	"event_ends_at" timestamp with time zone NOT NULL,
	"multi_day" boolean DEFAULT false NOT NULL,
	"event_same_as_billing" boolean DEFAULT true NOT NULL,
	"event_location_name" text,
	"event_line1" text,
	"event_line2" text,
	"event_city" text,
	"event_region" text,
	"event_postal_code" text,
	"event_country" text DEFAULT 'US' NOT NULL,
	"event_lat" double precision,
	"event_lng" double precision,
	"event_contact_name" text,
	"event_contact_mobile" text,
	"event_contact_email" "citext",
	"damage_waiver" boolean DEFAULT true NOT NULL,
	"damage_waiver_percent" numeric(6, 3) DEFAULT 10 NOT NULL,
	"travel_fee_cents" bigint DEFAULT 0 NOT NULL,
	"travel_fee_overridden" boolean DEFAULT false NOT NULL,
	"travel_info" jsonb,
	"misc_fees_cents" bigint DEFAULT 0 NOT NULL,
	"discount_kind" text,
	"discount_value" numeric(12, 3),
	"discount_after_tax" boolean DEFAULT false NOT NULL,
	"coupon_code" text,
	"coupon_cents" bigint DEFAULT 0 NOT NULL,
	"tax_percent" numeric(7, 4) DEFAULT 0 NOT NULL,
	"tax_overridden" boolean DEFAULT false NOT NULL,
	"deposit_kind" text DEFAULT 'percent' NOT NULL,
	"deposit_value" numeric(12, 3) DEFAULT 30 NOT NULL,
	"merchandise_cents" bigint DEFAULT 0 NOT NULL,
	"extras_cents" bigint DEFAULT 0 NOT NULL,
	"discount_cents" bigint DEFAULT 0 NOT NULL,
	"tax_cents" bigint DEFAULT 0 NOT NULL,
	"total_cents" bigint DEFAULT 0 NOT NULL,
	"deposit_due_cents" bigint DEFAULT 0 NOT NULL,
	"paid_cents" bigint DEFAULT 0 NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" text,
	"internal_notes" text,
	"customer_notes" text,
	"quote_sent_at" timestamp with time zone,
	"booked_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "orders_number" UNIQUE("tenant_id","number"),
	CONSTRAINT "orders_status" CHECK ("orders"."status" in ('draft','quote_sent','booked','completed','cancelled')),
	CONSTRAINT "orders_period" CHECK ("orders"."event_ends_at" > "orders"."event_starts_at"),
	CONSTRAINT "orders_discount_kind" CHECK ("orders"."discount_kind" is null or "orders"."discount_kind" in ('percent','amount')),
	CONSTRAINT "orders_deposit_kind" CHECK ("orders"."deposit_kind" in ('percent','amount'))
);
--> statement-breakpoint
CREATE TABLE "product_categories" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_categories_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "product_categories_slug" UNIQUE("tenant_id","slug")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid,
	"kind" text DEFAULT 'rental' NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"sku" text,
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"image_file_id" uuid,
	"price_staffed_cents" bigint DEFAULT 0 NOT NULL,
	"price_pickup_cents" bigint,
	"price_dropoff_cents" bigint,
	"base_hours" numeric(6, 2),
	"hourly_rate_cents" bigint,
	"min_hours" numeric(6, 2),
	"overtime_block_minutes" integer DEFAULT 15 NOT NULL,
	"overtime_block_cents" bigint DEFAULT 2500 NOT NULL,
	"turnaround_minutes" integer,
	"taxable" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"external_refs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "products_slug" UNIQUE("tenant_id","slug"),
	CONSTRAINT "products_kind" CHECK ("products"."kind" in ('rental','addon','service')),
	CONSTRAINT "products_status" CHECK ("products"."status" in ('active','draft','archived'))
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"order_line_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"blocked_until" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservations_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "reservations_qty" CHECK ("reservations"."quantity" > 0)
);
--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_pools" ADD CONSTRAINT "inventory_pools_tenant_id_product_id_products_tenant_id_id_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."products"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_pools" ADD CONSTRAINT "inventory_pools_tenant_id_location_id_locations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_tenant_id_order_id_orders_tenant_id_id_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."orders"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_tenant_id_product_id_products_tenant_id_id_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."products"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_location_id_locations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_customer_id_customers_tenant_id_id_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_category_id_product_categories_tenant_id_id_fk" FOREIGN KEY ("tenant_id","category_id") REFERENCES "public"."product_categories"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_tenant_id_order_id_orders_tenant_id_id_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."orders"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_tenant_id_order_line_id_order_lines_tenant_id_id_fk" FOREIGN KEY ("tenant_id","order_line_id") REFERENCES "public"."order_lines"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_tenant_id_product_id_products_tenant_id_id_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."products"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customers_email_idx" ON "customers" USING btree ("tenant_id","email");--> statement-breakpoint
CREATE INDEX "customers_phone_idx" ON "customers" USING btree ("tenant_id","phone");--> statement-breakpoint
CREATE INDEX "order_lines_order_idx" ON "order_lines" USING btree ("tenant_id","order_id");--> statement-breakpoint
CREATE INDEX "orders_calendar_idx" ON "orders" USING btree ("tenant_id","event_starts_at");--> statement-breakpoint
CREATE INDEX "orders_customer_idx" ON "orders" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("tenant_id","status","event_starts_at");--> statement-breakpoint
CREATE INDEX "products_category_idx" ON "products" USING btree ("tenant_id","category_id");--> statement-breakpoint
CREATE INDEX "reservations_lookup_idx" ON "reservations" USING btree ("tenant_id","product_id","location_id","starts_at");