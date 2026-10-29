-- Phase 1: isolation for the new tables, and stock rules that follow how a product is tracked.

SELECT app_enable_tenant_rls(t::regclass)
FROM unnest(ARRAY['product_location_prices','inventory_units','customer_addresses','credits','coupons',
                  'order_versions','credit_applications','payments']) AS t;
--> statement-breakpoint

-- Order history and payments are records: the app can add to them, never rewrite them.
REVOKE UPDATE, DELETE ON order_versions FROM rental_app;
--> statement-breakpoint
REVOKE DELETE ON payments FROM rental_app;
--> statement-breakpoint

-- Bookable quantity of a product at a location:
--   pooled      owned - out of service (no inventory row = 1, like Odoo)
--   serialized  units that are ready or being cleaned (maintenance / out of service are held)
--   none        never runs out
CREATE OR REPLACE FUNCTION app_capacity(p_product uuid, p_location uuid)
RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT CASE p.tracking
    WHEN 'none' THEN 1000000
    WHEN 'serialized' THEN (
      SELECT count(*)::int FROM inventory_units u
      WHERE u.tenant_id = p.tenant_id AND u.product_id = p.id AND u.location_id = p_location
        AND u.status IN ('ready','cleaning'))
    ELSE coalesce((
      SELECT quantity_owned - out_of_service FROM inventory_pools ip
      WHERE ip.tenant_id = p.tenant_id AND ip.product_id = p.id AND ip.location_id = p_location), 1)
  END
  FROM products p
  WHERE p.tenant_id = app_current_tenant() AND p.id = p_product
$$;
--> statement-breakpoint

-- True when bookings may exceed capacity (not tracked, or overbooking allowed here).
CREATE OR REPLACE FUNCTION app_overbook_ok(p_product uuid, p_location uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT p.tracking = 'none' OR coalesce((
    SELECT allow_overbooking FROM inventory_pools ip
    WHERE ip.tenant_id = p.tenant_id AND ip.product_id = p.id AND ip.location_id = p_location), false)
  FROM products p
  WHERE p.tenant_id = app_current_tenant() AND p.id = p_product
$$;
--> statement-breakpoint

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
  IF NOT coalesce(app_overbook_ok(p_product, p_location), false) THEN
    v_cap := app_capacity(p_product, p_location);
    v_used := app_reserved_peak(p_product, p_location, p_start, p_end, p_order);
    IF v_used + p_qty > v_cap THEN
      RAISE EXCEPTION 'NOT_AVAILABLE' USING DETAIL = json_build_object('product_id', p_product, 'owned', v_cap, 'held', v_used, 'requested', p_qty)::text;
    END IF;
  END IF;
  INSERT INTO reservations (tenant_id, order_id, order_line_id, product_id, location_id, quantity, starts_at, ends_at, blocked_until)
  VALUES (v_tenant, p_order, p_line, p_product, p_location, p_qty, p_start, p_end, p_blocked_until)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
--> statement-breakpoint

DROP FUNCTION IF EXISTS app_availability(uuid, timestamptz, timestamptz, uuid);
--> statement-breakpoint
-- Free quantity of every active product at a location for a time window.
CREATE FUNCTION app_availability(p_location uuid, p_from timestamptz, p_to timestamptz, p_exclude_order uuid DEFAULT NULL)
RETURNS TABLE (product_id uuid, owned integer, held integer, overbook boolean)
LANGUAGE sql STABLE AS $$
  SELECT p.id, app_capacity(p.id, p_location), app_reserved_peak(p.id, p_location, p_from, p_to, p_exclude_order),
         app_overbook_ok(p.id, p_location)
  FROM products p
  WHERE p.tenant_id = app_current_tenant() AND p.status = 'active'
$$;
--> statement-breakpoint

-- Units still free at the busiest moment of each local day, for the inventory heatmap.
CREATE OR REPLACE FUNCTION app_daily_availability(p_location uuid, p_from date, p_days integer, p_tz text)
RETURNS TABLE (product_id uuid, day date, owned integer, held integer)
LANGUAGE sql STABLE AS $$
  SELECT p.id, d::date, app_capacity(p.id, p_location),
         app_reserved_peak(p.id, p_location, (d::timestamp AT TIME ZONE p_tz), ((d + interval '1 day')::timestamp AT TIME ZONE p_tz), NULL)
  FROM products p
  CROSS JOIN generate_series(p_from::timestamp, (p_from + (least(greatest(p_days, 1), 62) - 1))::timestamp, interval '1 day') AS d
  WHERE p.tenant_id = app_current_tenant() AND p.status = 'active' AND p.tracking <> 'none' AND p.kind IN ('rental','addon')
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_capacity(uuid, uuid), app_overbook_ok(uuid, uuid),
  app_reserve_inventory(uuid, uuid, uuid, uuid, integer, timestamptz, timestamptz, timestamptz),
  app_availability(uuid, timestamptz, timestamptz, uuid), app_daily_availability(uuid, date, integer, text) TO rental_app;
