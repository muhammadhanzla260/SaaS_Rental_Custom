-- Defence in depth (QA B-22): the app role reads only the current workspace's row in tenants.
-- Before, tenants_read was USING (true), so one query bug could read every workspace's profile and
-- settings. Finding a workspace by its URL goes through a definer function that returns the id only.
DROP POLICY IF EXISTS tenants_read ON tenants;
--> statement-breakpoint
CREATE POLICY tenants_read ON tenants FOR SELECT USING (id = app_current_tenant());
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_tenant_id_by_slug(p_slug text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM tenants WHERE slug = p_slug
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_tenant_id_by_slug(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_tenant_id_by_slug(text) TO rental_app;
