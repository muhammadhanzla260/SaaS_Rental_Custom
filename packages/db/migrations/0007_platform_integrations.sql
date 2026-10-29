CREATE TABLE "platform_impersonations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" text NOT NULL,
	"tenant_id" uuid NOT NULL,
	"session_token_sha256" text NOT NULL,
	"reason" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "platform_impersonations_reason" CHECK (length("platform_impersonations"."reason") between 3 and 500)
);
--> statement-breakpoint
CREATE TABLE "released_slugs" (
	"slug" text NOT NULL,
	"released_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "released_slugs_slug_pk" PRIMARY KEY("slug")
);
--> statement-breakpoint
CREATE TABLE "mail_accounts" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid,
	"mode" text DEFAULT 'platform' NOT NULL,
	"provider" text DEFAULT 'other' NOT NULL,
	"host" text,
	"port" integer DEFAULT 587 NOT NULL,
	"security" text DEFAULT 'starttls' NOT NULL,
	"username" text,
	"secret_enc" text,
	"from_name" text,
	"from_email" text,
	"reply_to" text,
	"verified_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_accounts_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "mail_accounts_mode" CHECK ("mail_accounts"."mode" in ('platform','smtp')),
	CONSTRAINT "mail_accounts_security" CHECK ("mail_accounts"."security" in ('starttls','ssl','none'))
);
--> statement-breakpoint
CREATE TABLE "payment_accounts" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid,
	"provider" text DEFAULT 'none' NOT NULL,
	"publishable_key" text,
	"secret_enc" text,
	"key_mode" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_accounts_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "payment_accounts_provider" CHECK ("payment_accounts"."provider" in ('none','stripe'))
);
--> statement-breakpoint
CREATE TABLE "sms_accounts" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"provider" text DEFAULT 'none' NOT NULL,
	"sending_number" text,
	"account_id" text,
	"secret_enc" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sms_accounts_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "sms_accounts_provider" CHECK ("sms_accounts"."provider" in ('none','twilio','quo'))
);
--> statement-breakpoint
ALTER TABLE "invitations" DROP CONSTRAINT "invitations_role";--> statement-breakpoint
ALTER TABLE "memberships" DROP CONSTRAINT "memberships_role";--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "status" SET DEFAULT 'trial';--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "plan" SET DEFAULT 'growth';--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "brand_color" SET DEFAULT '#2C4FE0';--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "theme_mode" SET DEFAULT 'light';--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "radius" SET DEFAULT 'round';--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "location_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "commission_rate" numeric(7, 4);--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "vehicle" text;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "permissions" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "vehicle" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "rollout_phase" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "purge_after" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "platform_impersonations" ADD CONSTRAINT "platform_impersonations_admin_user_id_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_impersonations" ADD CONSTRAINT "platform_impersonations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_accounts" ADD CONSTRAINT "mail_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_accounts" ADD CONSTRAINT "mail_accounts_tenant_id_location_id_locations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_accounts" ADD CONSTRAINT "payment_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_accounts" ADD CONSTRAINT "payment_accounts_tenant_id_location_id_locations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","location_id") REFERENCES "public"."locations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_accounts" ADD CONSTRAINT "sms_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_impersonations_admin_idx" ON "platform_impersonations" USING btree ("admin_user_id","tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_accounts_org" ON "mail_accounts" USING btree ("tenant_id") WHERE "mail_accounts"."location_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "mail_accounts_location" ON "mail_accounts" USING btree ("tenant_id","location_id") WHERE "mail_accounts"."location_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_accounts_org" ON "payment_accounts" USING btree ("tenant_id") WHERE "payment_accounts"."location_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_accounts_location" ON "payment_accounts" USING btree ("tenant_id","location_id") WHERE "payment_accounts"."location_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "sms_accounts_org" ON "sms_accounts" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_role" CHECK ("invitations"."role" in ('owner','admin','manager','sales','coach','crew','accountant','viewer'));--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_role" CHECK ("memberships"."role" in ('owner','admin','manager','sales','coach','crew','accountant','viewer'));--> statement-breakpoint
UPDATE "tenants" SET "plan" = 'growth' WHERE "plan" NOT IN ('starter','growth','scale');--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_plan" CHECK ("tenants"."plan" in ('starter','growth','scale'));