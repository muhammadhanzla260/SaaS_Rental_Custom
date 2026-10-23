-- Phase 1 security and inventory logic.

SELECT app_enable_tenant_rls(t::regclass)
FROM unnest(ARRAY['product_categories','products','inventory_pools','customers','orders','order_lines','reservations']) AS t;
--> statement-breakpoint

-- Peak quantity of a product already held at a location during [p_from, p_to).
-- Existing reservations are busy from their start until return + cleanup
-- (blocked_until), exactly like Odoo product_product._iter_rental_blocked_intervals.
-- The peak happens at the window start or at some reservation's start.
CREATE OR REPLACE FUNCTION app_reserved_peak(p_product uuid, p_location uuid, p_from timestamptz, p_to timestamptz, p_exclude_order uuid DEFAULT NULL)
RETURNS integer LANGUAGE sql STABLE AS $$
  WITH r AS (
    SELECT quantity, starts_at, blocked_until FROM reservations
    WHERE tenant_id = app_current_tenant() AND product_id = p_product AND location_id = p_location
      AND starts_at < p_to AND blocked_until > p_from
      AND (p_exclude_order IS NULL OR order_id <> p_exclude_order)
  ), points AS (
    SELECT greatest(starts_at, p_from) AS pt FROM r UNION SELECT p_from
  )
  SELECT coalesce(max((SELECT sum(quantity) FROM r WHERE r.starts_at <= points.pt AND r.blocked_until > points.pt)), 0)::int
  FROM points
$$;
--> statement-breakpoint

-- Quantity owned at a location. No inventory row = 1, like Odoo, where any
-- confirmed booking blocked the product.
CREATE OR REPLACE FUNCTION app_capacity(p_product uuid, p_location uuid)
RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT coalesce((SELECT quantity_owned FROM inventory_pools
                   WHERE tenant_id = app_current_tenant() AND product_id = p_product AND location_id = p_location), 1)
$$;
--> statement-breakpoint

-- Atomically hold equipment for a booked order line. Serialised per
-- product+location with an advisory lock, so two people booking the last unit
-- at the same moment cannot both succeed. Raises NOT_AVAILABLE otherwise.
CREATE OR REPLACE FUNCTION app_reserve_inventory(
  p_order uuid, p_line uuid, p_product uuid, p_location uuid, p_qty integer,
  p_start timestamptz, p_end timestamptz, p_blocked_until timestamptz)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_tenant uuid := app_current_tenant();
  v_cap integer;
  v_used integer;
  v_id uuid;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'NO_TENANT'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_tenant::text || p_product::text || p_location::text, 0));
  v_cap := app_capacity(p_product, p_location);
  v_used := app_reserved_peak(p_product, p_location, p_start, p_end, p_order);
  IF v_used + p_qty > v_cap THEN
    RAISE EXCEPTION 'NOT_AVAILABLE' USING DETAIL = json_build_object('product_id', p_product, 'owned', v_cap, 'held', v_used, 'requested', p_qty)::text;
  END IF;
  INSERT INTO reservations (tenant_id, order_id, order_line_id, product_id, location_id, quantity, starts_at, ends_at, blocked_until)
  VALUES (v_tenant, p_order, p_line, p_product, p_location, p_qty, p_start, p_end, p_blocked_until)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
--> statement-breakpoint

-- Free quantity of every active product at a location for a time window.
CREATE OR REPLACE FUNCTION app_availability(p_location uuid, p_from timestamptz, p_to timestamptz, p_exclude_order uuid DEFAULT NULL)
RETURNS TABLE (product_id uuid, owned integer, held integer)
LANGUAGE sql STABLE AS $$
  SELECT p.id, app_capacity(p.id, p_location), app_reserved_peak(p.id, p_location, p_from, p_to, p_exclude_order)
  FROM products p
  WHERE p.tenant_id = app_current_tenant() AND p.status = 'active'
$$;
--> statement-breakpoint

-- Next document number for the current tenant: Q-00001, INV-00001 ...
CREATE OR REPLACE FUNCTION app_next_number(p_scope text, p_default_prefix text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_tenant uuid := app_current_tenant();
  v_prefix text;
  v_pad integer;
  v_value bigint;
BEGIN
  INSERT INTO number_sequences (tenant_id, scope, prefix) VALUES (v_tenant, p_scope, p_default_prefix)
  ON CONFLICT (tenant_id, scope) DO NOTHING;
  UPDATE number_sequences SET next_value = next_value + 1
  WHERE tenant_id = v_tenant AND scope = p_scope
  RETURNING prefix, padding, next_value - 1 INTO v_prefix, v_pad, v_value;
  RETURN v_prefix || lpad(v_value::text, v_pad, '0');
END $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_reserved_peak(uuid, uuid, timestamptz, timestamptz, uuid), app_capacity(uuid, uuid),
  app_reserve_inventory(uuid, uuid, uuid, uuid, integer, timestamptz, timestamptz, timestamptz),
  app_availability(uuid, timestamptz, timestamptz, uuid), app_next_number(text, text) TO rental_app;
