CREATE TABLE "coach_checklists" (
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"override_reason" text,
	"sop_notes" text,
	"damage" boolean DEFAULT false NOT NULL,
	"damage_notes" text,
	"maintenance_flag" boolean DEFAULT false NOT NULL,
	"en_route_at" timestamp with time zone,
	"en_route_by_user_id" text,
	"tracking" boolean DEFAULT false NOT NULL,
	"last_lat" double precision,
	"last_lng" double precision,
	"last_fix_at" timestamp with time zone,
	"eta_minutes" integer,
	"text1_at" timestamp with time zone,
	"text2_at" timestamp with time zone,
	"arrived_at" timestamp with time zone,
	"arrived_lat" double precision,
	"arrived_lng" double precision,
	"arrived_distance_m" integer,
	"event_started_at" timestamp with time zone,
	"event_start_lat" double precision,
	"event_start_lng" double precision,
	"event_start_variance_min" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coach_checklists_tenant_id_order_id_pk" PRIMARY KEY("tenant_id","order_id")
);
--> statement-breakpoint
CREATE TABLE "coach_gps_pings" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"accuracy_m" integer,
	"eta_minutes" integer,
	"ignored" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coach_gps_pings_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "coach_photos" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"file_id" uuid NOT NULL,
	"taken_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uploaded_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coach_photos_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "coach_photos_kind" CHECK ("coach_photos"."kind" in ('load','setup','closeout','damage'))
);
--> statement-breakpoint
CREATE TABLE "order_staff" (
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"is_lead" boolean DEFAULT false NOT NULL,
	"assigned_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_staff_tenant_id_order_id_user_id_pk" PRIMARY KEY("tenant_id","order_id","user_id"),
	CONSTRAINT "order_staff_role" CHECK ("order_staff"."role" in ('coach','crew')),
	CONSTRAINT "order_staff_lead" CHECK (not "order_staff"."is_lead" or "order_staff"."role" = 'coach')
);
--> statement-breakpoint
ALTER TABLE "coach_checklists" ADD CONSTRAINT "coach_checklists_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_checklists" ADD CONSTRAINT "coach_checklists_tenant_id_order_id_orders_tenant_id_id_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."orders"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_gps_pings" ADD CONSTRAINT "coach_gps_pings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_gps_pings" ADD CONSTRAINT "coach_gps_pings_tenant_id_order_id_orders_tenant_id_id_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."orders"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_photos" ADD CONSTRAINT "coach_photos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_photos" ADD CONSTRAINT "coach_photos_tenant_id_order_id_orders_tenant_id_id_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."orders"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_photos" ADD CONSTRAINT "coach_photos_tenant_id_file_id_files_tenant_id_id_fk" FOREIGN KEY ("tenant_id","file_id") REFERENCES "public"."files"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_staff" ADD CONSTRAINT "order_staff_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_staff" ADD CONSTRAINT "order_staff_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_staff" ADD CONSTRAINT "order_staff_tenant_id_order_id_orders_tenant_id_id_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."orders"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "coach_checklists_tracking_idx" ON "coach_checklists" USING btree ("tenant_id") WHERE "coach_checklists"."tracking";--> statement-breakpoint
CREATE INDEX "coach_gps_pings_order_idx" ON "coach_gps_pings" USING btree ("tenant_id","order_id","at");--> statement-breakpoint
CREATE INDEX "coach_gps_pings_age_idx" ON "coach_gps_pings" USING btree ("at");--> statement-breakpoint
CREATE INDEX "coach_photos_order_idx" ON "coach_photos" USING btree ("tenant_id","order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_staff_one_lead" ON "order_staff" USING btree ("tenant_id","order_id") WHERE "order_staff"."is_lead";--> statement-breakpoint
CREATE INDEX "order_staff_user_idx" ON "order_staff" USING btree ("tenant_id","user_id");--> statement-breakpoint
SELECT app_enable_tenant_rls('order_staff'::regclass);--> statement-breakpoint
SELECT app_enable_tenant_rls('coach_checklists'::regclass);--> statement-breakpoint
SELECT app_enable_tenant_rls('coach_photos'::regclass);--> statement-breakpoint
SELECT app_enable_tenant_rls('coach_gps_pings'::regclass);
