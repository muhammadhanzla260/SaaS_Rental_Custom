-- Document numbers per rendered prefix: Q-AUS-01042 and Q-DAL-00007 count separately,
-- INV-2026-0001 restarts each year. The app renders the prefix ({LOC}, {YYYY}) and
-- passes scope = '<kind>:<prefix>'.
CREATE OR REPLACE FUNCTION app_next_number(p_scope text, p_prefix text, p_padding integer)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_tenant uuid := app_current_tenant();
  v_pad integer;
  v_value bigint;
BEGIN
  INSERT INTO number_sequences (tenant_id, scope, prefix, padding) VALUES (v_tenant, p_scope, p_prefix, p_padding)
  ON CONFLICT (tenant_id, scope) DO NOTHING;
  UPDATE number_sequences SET next_value = next_value + 1, padding = p_padding
  WHERE tenant_id = v_tenant AND scope = p_scope
  RETURNING padding, next_value - 1 INTO v_pad, v_value;
  RETURN p_prefix || lpad(v_value::text, v_pad, '0');
END $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_next_number(text, text, integer) TO rental_app;
--> statement-breakpoint

-- A workspace URL given up by a rename stays blocked for 90 days (no takeover of old links).
CREATE OR REPLACE FUNCTION app_release_slug(p_admin text, p_slug text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM app_assert_platform_admin(p_admin);
  INSERT INTO released_slugs (slug) VALUES (p_slug)
  ON CONFLICT (slug) DO UPDATE SET released_at = now();
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_release_slug(text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_release_slug(text, text) TO rental_app;
