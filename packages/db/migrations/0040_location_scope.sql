-- Location-scoped members (QA B-14): a Manager or Sales member limited to some locations sees and
-- changes only those locations' orders and what hangs off them. The app sets app.location_ids for
-- such a member (comma-separated); empty means every location, as for everyone else and the worker.
-- These policies are RESTRICTIVE: they narrow tenant_isolation, never widen it.
CREATE OR REPLACE FUNCTION app_location_visible(p_location uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.location_ids', true), '') = ''
      OR p_location::text = ANY (string_to_array(current_setting('app.location_ids', true), ','))
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_location_visible(uuid) TO rental_app;
--> statement-breakpoint
DROP POLICY IF EXISTS location_scope ON orders;
--> statement-breakpoint
CREATE POLICY location_scope ON orders AS RESTRICTIVE
  USING (app_location_visible(location_id)) WITH CHECK (app_location_visible(location_id));
--> statement-breakpoint
DROP POLICY IF EXISTS location_scope ON messages;
--> statement-breakpoint
CREATE POLICY location_scope ON messages AS RESTRICTIVE
  USING (location_id IS NULL OR app_location_visible(location_id)) WITH CHECK (location_id IS NULL OR app_location_visible(location_id));
--> statement-breakpoint
DROP POLICY IF EXISTS location_scope ON invoices;
--> statement-breakpoint
CREATE POLICY location_scope ON invoices AS RESTRICTIVE
  USING (coalesce(current_setting('app.location_ids', true), '') = '' OR EXISTS (SELECT 1 FROM orders o WHERE o.tenant_id = invoices.tenant_id AND o.id = invoices.order_id));
--> statement-breakpoint
DROP POLICY IF EXISTS location_scope ON payments;
--> statement-breakpoint
CREATE POLICY location_scope ON payments AS RESTRICTIVE
  USING (coalesce(current_setting('app.location_ids', true), '') = '' OR EXISTS (SELECT 1 FROM orders o WHERE o.tenant_id = payments.tenant_id AND o.id = payments.order_id));
