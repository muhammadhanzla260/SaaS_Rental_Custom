-- Platform console audit log: every organization, newest first, with the org and actor names.
CREATE OR REPLACE FUNCTION app_platform_audit(p_admin text, p_limit integer DEFAULT 200, p_tenant uuid DEFAULT NULL, p_platform_only boolean DEFAULT false)
RETURNS TABLE (id uuid, at timestamptz, tenant_id uuid, tenant_name text, tenant_slug text, actor_type text, actor_name text,
               actor_email text, entity_type text, action text, changes jsonb, ip text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM app_assert_platform_admin(p_admin);
  RETURN QUERY
  SELECT a.id, a.at, a.tenant_id, t.name, t.slug::text, a.actor_type, u.name, u.email::text, a.entity_type, a.action, a.changes, host(a.ip)
  FROM audit_log a
  LEFT JOIN tenants t ON t.id = a.tenant_id
  LEFT JOIN users u ON u.id = a.actor_user_id
  WHERE (p_tenant IS NULL OR a.tenant_id = p_tenant)
    AND (NOT p_platform_only OR a.actor_type = 'platform')
  ORDER BY a.at DESC
  LIMIT least(greatest(p_limit, 1), 1000);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_platform_audit(text, integer, uuid, boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_platform_audit(text, integer, uuid, boolean) TO rental_app;
