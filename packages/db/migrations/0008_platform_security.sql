-- Security for the platform console, support sessions and integrations.

-- Integration accounts are tenant data: standard isolation.
SELECT app_enable_tenant_rls(t::regclass)
FROM unnest(ARRAY['mail_accounts','sms_accounts','payment_accounts']) AS t;
--> statement-breakpoint

-- Platform tables are reachable only through the functions below.
ALTER TABLE platform_impersonations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE released_slugs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON platform_impersonations, released_slugs FROM rental_app;
--> statement-breakpoint

-- The app may change a user's profile fields, never the platform-admin flag.
REVOKE UPDATE ON users FROM rental_app;
--> statement-breakpoint
GRANT UPDATE (name, email, email_verified, image, updated_at) ON users TO rental_app;
--> statement-breakpoint

-- Platform actions are audited with their own actor type.
ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_actor_type_check;
--> statement-breakpoint
ALTER TABLE audit_log ADD CONSTRAINT audit_log_actor_type_check
  CHECK (actor_type IN ('user','customer','system','api','ai','platform'));
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_is_platform_admin(p_user_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT is_platform_admin FROM users WHERE id = p_user_id), false)
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_assert_platform_admin(p_user_id text) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT app_is_platform_admin(p_user_id) THEN
    RAISE EXCEPTION 'not a platform admin' USING ERRCODE = '42501';
  END IF;
END $$;
--> statement-breakpoint

-- Every organization with its owner, user count and onboarding state (console list).
CREATE OR REPLACE FUNCTION app_platform_orgs(p_admin text)
RETURNS TABLE (
  id uuid, slug text, name text, status text, plan text, rollout_phase integer,
  created_at timestamptz, onboarded_at timestamptz, onboarding jsonb, brand_color text, logo_file_id uuid,
  timezone text, currency text, country text, closed_at timestamptz, purge_after timestamptz,
  owner_name text, owner_email text, owner_pending boolean, users integer, locations integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM app_assert_platform_admin(p_admin);
  RETURN QUERY
  SELECT t.id, t.slug::text, t.name, t.status, t.plan, t.rollout_phase,
         t.created_at, t.onboarded_at, t.settings -> 'onboarding', t.brand_color, t.logo_file_id,
         t.timezone, t.currency, t.country, t.closed_at, t.purge_after,
         coalesce(o.name, inv.name), coalesce(o.email, inv.email), (o.email IS NULL AND inv.email IS NOT NULL),
         (SELECT count(*)::int FROM memberships m WHERE m.tenant_id = t.id AND m.status = 'active'),
         (SELECT count(*)::int FROM locations l WHERE l.tenant_id = t.id)
  FROM tenants t
  LEFT JOIN LATERAL (
    SELECT u.name, u.email::text AS email FROM memberships m JOIN users u ON u.id = m.user_id
    WHERE m.tenant_id = t.id AND m.role = 'owner' ORDER BY m.created_at LIMIT 1
  ) o ON true
  LEFT JOIN LATERAL (
    SELECT i.name, i.email::text AS email FROM invitations i
    WHERE i.tenant_id = t.id AND i.role = 'owner' AND i.accepted_at IS NULL AND i.revoked_at IS NULL
    ORDER BY i.created_at DESC LIMIT 1
  ) inv ON true
  ORDER BY t.created_at DESC;
END $$;
--> statement-breakpoint

-- Start a read-only support session bound to the admin's login session.
CREATE OR REPLACE FUNCTION app_platform_start_impersonation(p_admin text, p_tenant uuid, p_session_sha256 text, p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM app_assert_platform_admin(p_admin);
  UPDATE platform_impersonations SET ended_at = now()
  WHERE admin_user_id = p_admin AND session_token_sha256 = p_session_sha256 AND ended_at IS NULL;
  INSERT INTO platform_impersonations (admin_user_id, tenant_id, session_token_sha256, reason)
  VALUES (p_admin, p_tenant, p_session_sha256, p_reason) RETURNING id INTO v_id;
  INSERT INTO audit_log (tenant_id, actor_type, actor_user_id, entity_type, entity_id, action, changes)
  VALUES (p_tenant, 'platform', p_admin, 'tenant', p_tenant, 'platform.impersonation_started', jsonb_build_object('reason', p_reason));
  RETURN v_id;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_platform_end_impersonation(p_admin text, p_session_sha256 text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  FOR r IN UPDATE platform_impersonations SET ended_at = now()
           WHERE admin_user_id = p_admin AND session_token_sha256 = p_session_sha256 AND ended_at IS NULL
           RETURNING tenant_id
  LOOP
    INSERT INTO audit_log (tenant_id, actor_type, actor_user_id, entity_type, entity_id, action)
    VALUES (r.tenant_id, 'platform', p_admin, 'tenant', r.tenant_id, 'platform.impersonation_ended');
  END LOOP;
END $$;
--> statement-breakpoint

-- The active support session for this admin + login session + tenant (12 hours max).
CREATE OR REPLACE FUNCTION app_active_impersonation(p_user text, p_session_sha256 text, p_tenant uuid)
RETURNS TABLE (id uuid, reason text, started_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT i.id, i.reason, i.started_at FROM platform_impersonations i
  WHERE i.admin_user_id = p_user AND i.session_token_sha256 = p_session_sha256 AND i.tenant_id = p_tenant
    AND i.ended_at IS NULL AND i.started_at > now() - interval '12 hours'
    AND app_is_platform_admin(p_user)
  ORDER BY i.started_at DESC LIMIT 1
$$;
--> statement-breakpoint

-- Workspace addresses: taken by a live org, or released less than 90 days ago.
CREATE OR REPLACE FUNCTION app_slug_taken(p_slug text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM tenants WHERE slug = p_slug)
      OR EXISTS (SELECT 1 FROM released_slugs WHERE slug = p_slug AND released_at > now() - interval '90 days')
$$;
--> statement-breakpoint

-- Organizations a user belongs to (adds status for the suspended banner and the org picker).
DROP FUNCTION IF EXISTS app_user_tenants(text);
--> statement-breakpoint
CREATE FUNCTION app_user_tenants(p_user_id text)
RETURNS TABLE (tenant_id uuid, slug text, name text, role text, brand_color text, logo_file_id uuid, status text, onboarded boolean, locations integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id, t.slug::text, t.name, m.role, t.brand_color, t.logo_file_id, t.status, t.onboarded_at IS NOT NULL,
         (SELECT count(*)::int FROM locations l WHERE l.tenant_id = t.id AND l.is_active)
  FROM memberships m JOIN tenants t ON t.id = m.tenant_id
  WHERE m.user_id = p_user_id AND m.status = 'active' AND t.status <> 'closed'
  ORDER BY t.name
$$;
--> statement-breakpoint

-- Invitation lookup by token hash, with the invitee's details.
DROP FUNCTION IF EXISTS app_find_invitation(text);
--> statement-breakpoint
CREATE FUNCTION app_find_invitation(p_token_sha256 text)
RETURNS TABLE (tenant_id uuid, invitation_id uuid, email text, name text, role text, expires_at timestamptz,
               accepted_at timestamptz, revoked_at timestamptz, tenant_name text, tenant_slug text, tenant_status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT i.tenant_id, i.id, i.email::text, i.name, i.role, i.expires_at, i.accepted_at, i.revoked_at, t.name, t.slug::text, t.status
  FROM invitations i JOIN tenants t ON t.id = i.tenant_id
  WHERE i.token_sha256 = p_token_sha256
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION app_is_platform_admin(text), app_assert_platform_admin(text), app_platform_orgs(text),
  app_platform_start_impersonation(text, uuid, text, text), app_platform_end_impersonation(text, text),
  app_active_impersonation(text, text, uuid), app_slug_taken(text), app_user_tenants(text), app_find_invitation(text)
  FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_is_platform_admin(text), app_assert_platform_admin(text), app_platform_orgs(text),
  app_platform_start_impersonation(text, uuid, text, text), app_platform_end_impersonation(text, text),
  app_active_impersonation(text, text, uuid), app_slug_taken(text), app_user_tenants(text), app_find_invitation(text)
  TO rental_app;
