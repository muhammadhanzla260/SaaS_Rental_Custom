CREATE TABLE "coupons" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"code" "citext" NOT NULL,
	"kind" text DEFAULT 'percent' NOT NULL,
	"value" numeric(12, 3) NOT NULL,
	"valid_from" date,
	"valid_until" date,
	"max_uses" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupons_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "coupons_code" UNIQUE("tenant_id","code"),
	CONSTRAINT "coupons_kind" CHECK ("coupons"."kind" in ('percent','amount')),
	CONSTRAINT "coupons_value" CHECK ("coupons"."value" > 0)
);
--> statement-breakpoint
CREATE TABLE "credit_applications" (
	"tenant_id" uuid NOT NULL,
	"credit_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_applications_tenant_id_credit_id_order_id_pk" PRIMARY KEY("tenant_id","credit_id","order_id"),
	CONSTRAINT "credit_applications_amount" CHECK ("credit_applications"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "credits" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"code" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"reason" text,
	"valid_until" date,
	"source_order_id" uuid,
	"created_by_user_id" text,
	"voided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credits_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "credits_code" UNIQUE("tenant_id","code"),
	CONSTRAINT "credits_kind" CHECK ("credits"."kind" in ('rain_check','wallet','goodwill')),
	CONSTRAINT "credits_amount" CHECK ("credits"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "customer_addresses" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"label" text NOT NULL,
	"kind" text DEFAULT 'event' NOT NULL,
	"line1" text,
	"line2" text,
	"city" text,
	"region" text,
	"postal_code" text,
	"country" text DEFAULT 'US' NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_addresses_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "customer_addresses_kind" CHECK ("customer_addresses"."kind" in ('billing','event'))
);
--> statement-breakpoint
CREATE TABLE "inventory_units" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"label" text NOT NULL,
	"serial" text,
	"status" text DEFAULT 'ready' NOT NULL,
	"notes" text,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_units_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "inventory_units_status" CHECK ("inventory_units"."status" in ('ready','cleaning','maintenance','out_of_service'))
);
--> statement-breakpoint
CREATE TABLE "order_versions" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"action" text NOT NULL,
	"diff" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"totals" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_user_id" text,
	"actor_name" text,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_versions_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "order_versions_version" UNIQUE("tenant_id","order_id","version")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"order_id" uuid NOT NULL,
	"method" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"reference" text,
	"note" text,
	"status" text DEFAULT 'received' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "payments_number" UNIQUE("tenant_id","number"),
	CONSTRAINT "payments_method" CHECK ("payments"."method" in ('cash','check','zelle','venmo','ach','card','link','other')),
	CONSTRAINT "payments_status" CHECK ("payments"."status" in ('received','refunded','void')),
	CONSTRAINT "payments_amount" CHECK ("payments"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "product_location_prices" (
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"service_mode" text NOT NULL,
	"price_cents" bigint NOT NULL,
	CONSTRAINT "product_location_prices_tenant_id_product_id_location_id_service_mode_pk" PRIMARY KEY("tenant_id","product_id","location_id","service_mode"),
	CONSTRAINT "product_location_prices_mode" CHECK ("product_location_prices"."service_mode" in ('staffed','pickup','dropoff')),
	CONSTRAINT "product_location_prices_price" CHECK ("product_location_prices"."price_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "products" DROP CONSTRAINT "products_kind";--> statement-breakpoint
ALTER TABLE "order_lines" ALTER COLUMN "product_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "referred_by_customer_id" uuid;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "marketing_opt_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_pools" ADD COLUMN "out_of_service" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_pools" ADD COLUMN "allow_overbooking" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "order_lines" ADD COLUMN "taxable" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "contact_confirmed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "customer_address_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "event_miles" numeric(8, 2);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "miles_overridden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "setup_surface" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "event_location_fee" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "event_location_fee_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "billing" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "salesperson_user_id" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "referred_by_customer_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "coupon_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "credit_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "unpaid_reason" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "expected_payment_on" date;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "follow_up_notes" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "tracking" text DEFAULT 'pooled' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "icon" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "tint" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "commissionable" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "suggested_addon_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_applications" ADD CONSTRAINT "credit_applications_tenant_id_credit_id_credits_tenant_id_id_fk" FOREIGN KEY ("tenant_id","credit_id") REFERENCES "public"."credits"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_applications" ADD CONSTRAINT "credit_applications_tenant_id_order_id_orders_tenant_id_id_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."orders"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credits" ADD CONSTRAINT "credits_tenant_id_customer_id_customers_tenant_id_id_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_tenant_id_customer_id_customers_tenant_id_id_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_units" ADD CONSTRAINT "inventory_units_tenant_id_product_id_products_tenant_id_id_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."products"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_units" ADD CONSTRAINT "inventory_units_tenant_id_location_id_locations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_versions" ADD CONSTRAINT "order_versions_tenant_id_order_id_orders_tenant_id_id_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."orders"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_order_id_orders_tenant_id_id_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."orders"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_location_prices" ADD CONSTRAINT "product_location_prices_tenant_id_product_id_products_tenant_id_id_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."products"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_location_prices" ADD CONSTRAINT "product_location_prices_tenant_id_location_id_locations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credits_customer_idx" ON "credits" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "customer_addresses_customer_idx" ON "customer_addresses" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "inventory_units_product_idx" ON "inventory_units" USING btree ("tenant_id","product_id","location_id");--> statement-breakpoint
CREATE INDEX "payments_order_idx" ON "payments" USING btree ("tenant_id","order_id");--> statement-breakpoint
ALTER TABLE "inventory_pools" ADD CONSTRAINT "inventory_pools_oos" CHECK ("inventory_pools"."out_of_service" >= 0 and "inventory_pools"."out_of_service" <= "inventory_pools"."quantity_owned");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_tracking" CHECK ("products"."tracking" in ('pooled','serialized','none'));--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_kind" CHECK ("products"."kind" in ('rental','addon','service','fee','merchandise'));