-- Phase 2a: isolation for templates and the message log; quote-link lookup for the public page.

SELECT app_enable_tenant_rls(t::regclass) FROM unnest(ARRAY['message_templates','messages']) AS t;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS orders_access_token_hash ON orders (access_token_hash) WHERE access_token_hash IS NOT NULL;
--> statement-breakpoint

-- The customer's quote page has no workspace context. Given the sha256 of the
-- link's token, return which workspace and order it belongs to (ids only);
-- everything else is then read inside that workspace with row-level security.
CREATE OR REPLACE FUNCTION app_order_by_token(p_hash text)
RETURNS TABLE (tenant_id uuid, order_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT o.tenant_id, o.id FROM orders o
  JOIN tenants t ON t.id = o.tenant_id
  WHERE o.access_token_hash = p_hash AND length(p_hash) = 64 AND t.status NOT IN ('closed')
  LIMIT 1
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_order_by_token(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_order_by_token(text) TO rental_app;
