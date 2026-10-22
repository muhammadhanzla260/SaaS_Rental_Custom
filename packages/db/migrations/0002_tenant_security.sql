-- Tenant security layer.
--
-- The web app connects as `rental_app`, which is not a table owner, so
-- row-level security always applies to it. Each request runs inside
-- withTenant(), which sets app.tenant_id for that transaction only.
-- Migrations and the worker connect as the owner role.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rental_app') THEN
    CREATE ROLE rental_app NOLOGIN;
  END IF;
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO rental_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO rental_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO rental_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO rental_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO rental_app;
--> statement-breakpoint

-- Current tenant for this transaction, or NULL.
CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.tenant_id', true), '')::uuid
$$;
--> statement-breakpoint

-- Turns on the standard isolation policy for a tenant-scoped table.
-- Later migrations call this for every new table that has tenant_id.
CREATE OR REPLACE FUNCTION app_enable_tenant_rls(tbl regclass) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tbl);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %s', tbl);
  EXECUTE format(
    'CREATE POLICY tenant_isolation ON %s USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())',
    tbl);
END $$;
--> statement-breakpoint
SELECT app_enable_tenant_rls(t::regclass)
FROM unnest(ARRAY['memberships','invitations','locations','membership_locations','warehouses','tax_rates','number_sequences','files']) AS t;
--> statement-breakpoint

-- tenants is global: anyone may look a tenant up (by slug) or create one
-- (onboarding), but only the current tenant can change or delete itself.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenants_read ON tenants FOR SELECT USING (true);
--> statement-breakpoint
CREATE POLICY tenants_create ON tenants FOR INSERT WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY tenants_update ON tenants FOR UPDATE USING (id = app_current_tenant()) WITH CHECK (id = app_current_tenant());
--> statement-breakpoint
CREATE POLICY tenants_delete ON tenants FOR DELETE USING (id = app_current_tenant());
--> statement-breakpoint

-- Organisations a user belongs to. Crosses tenants, so it runs as the owner.
CREATE OR REPLACE FUNCTION app_user_tenants(p_user_id text)
RETURNS TABLE (tenant_id uuid, slug text, name text, role text, brand_color text, logo_file_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id, t.slug::text, t.name, m.role, t.brand_color, t.logo_file_id
  FROM memberships m JOIN tenants t ON t.id = m.tenant_id
  WHERE m.user_id = p_user_id AND m.status = 'active' AND t.status <> 'closed'
  ORDER BY t.name
$$;
--> statement-breakpoint

-- Invitation lookup by token hash (the invitee is not a member yet).
CREATE OR REPLACE FUNCTION app_find_invitation(p_token_sha256 text)
RETURNS TABLE (tenant_id uuid, invitation_id uuid, email text, role text, expires_at timestamptz,
               accepted_at timestamptz, revoked_at timestamptz, tenant_name text, tenant_slug text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT i.tenant_id, i.id, i.email::text, i.role, i.expires_at, i.accepted_at, i.revoked_at, t.name, t.slug::text
  FROM invitations i JOIN tenants t ON t.id = i.tenant_id
  WHERE i.token_sha256 = p_token_sha256
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_user_tenants(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_find_invitation(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_user_tenants(text), app_find_invitation(text), app_current_tenant() TO rental_app;
--> statement-breakpoint

-- Audit log, partitioned by month. The default partition catches anything
-- the worker has not created a monthly partition for yet.
CREATE TABLE audit_log (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  at timestamptz NOT NULL DEFAULT now(),
  actor_type text NOT NULL CHECK (actor_type IN ('user','customer','system','api','ai')),
  actor_user_id text,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  action text NOT NULL,
  changes jsonb,
  ip inet,
  PRIMARY KEY (tenant_id, id, at)
) PARTITION BY RANGE (at);
--> statement-breakpoint
CREATE TABLE audit_log_default PARTITION OF audit_log DEFAULT;
--> statement-breakpoint
CREATE INDEX audit_log_entity ON audit_log (tenant_id, entity_type, entity_id, at DESC);
--> statement-breakpoint
SELECT app_enable_tenant_rls('audit_log'::regclass);
--> statement-breakpoint
GRANT SELECT, INSERT ON audit_log TO rental_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON audit_log FROM rental_app;
--> statement-breakpoint

-- Creates a month's audit partition (the worker calls it daily for next month).
CREATE OR REPLACE FUNCTION app_ensure_audit_partition(p_month date DEFAULT (date_trunc('month', now()) + interval '1 month')::date)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  start_d date := date_trunc('month', p_month)::date;
  end_d date := (date_trunc('month', p_month) + interval '1 month')::date;
  part text := format('audit_log_%s', to_char(start_d, 'YYYY_MM'));
BEGIN
  IF to_regclass(part) IS NULL THEN
    EXECUTE format('CREATE TABLE %I PARTITION OF audit_log FOR VALUES FROM (%L) TO (%L)', part, start_d, end_d);
  END IF;
  RETURN part;
END $$;
--> statement-breakpoint
SELECT app_ensure_audit_partition((date_trunc('month', now()) + interval '1 month')::date);
