ALTER TABLE "orders" ADD COLUMN "charge_lock_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "status" text DEFAULT 'done' NOT NULL;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_status" CHECK ("refunds"."status" in ('pending','done','owed'));--> statement-breakpoint
-- Reserve equipment for a booked order line (QA B-06, B-07).
-- The order's own holds now count: reserveAll deletes them first, so what is left are the lines of
-- this save, and the same product on two lines can no longer take more units than exist.
-- The check window runs to the end of the cleanup (blocked_until), so this booking's cleanup cannot
-- overlap a later booking of the last unit, whichever of the two was booked first.
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
    v_used := app_reserved_peak(p_product, p_location, p_start, greatest(p_end, p_blocked_until), NULL);
    IF v_used + p_qty > v_cap THEN
      RAISE EXCEPTION 'NOT_AVAILABLE' USING DETAIL = json_build_object('product_id', p_product, 'owned', v_cap, 'held', v_used, 'requested', p_qty)::text;
    END IF;
  END IF;
  INSERT INTO reservations (tenant_id, order_id, order_line_id, product_id, location_id, quantity, starts_at, ends_at, blocked_until)
  VALUES (v_tenant, p_order, p_line, p_product, p_location, p_qty, p_start, p_end, p_blocked_until)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
