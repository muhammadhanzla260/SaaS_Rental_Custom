CREATE TABLE "report_schedules" (
	"tenant_id" uuid NOT NULL,
	"report_key" text NOT NULL,
	"period" text DEFAULT 'this_month' NOT NULL,
	"location_id" uuid,
	"created_by_user_id" text,
	"last_sent_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_schedules_tenant_id_report_key_pk" PRIMARY KEY("tenant_id","report_key"),
	CONSTRAINT "report_schedules_period" CHECK ("report_schedules"."period" in ('this_month','last_month','quarter','year'))
);
--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
SELECT app_enable_tenant_rls('report_schedules'::regclass);