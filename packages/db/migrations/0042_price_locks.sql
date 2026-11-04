-- Price locks (Tentpole has to keep what a customer was quoted): each order keeps the rules it was
-- priced with, each line the product pricing it was priced with. Written so it can safely run twice.
ALTER TABLE "order_lines" ADD COLUMN IF NOT EXISTS "pricing" jsonb;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "pricing_rules" jsonb;--> statement-breakpoint
-- Existing lines: the product's pricing as it is today (with the order location's branch prices), so
-- from now on editing a product no longer changes them. Their base price and extra-time rate were
-- already kept on the line and still win over these.
UPDATE order_lines l SET pricing = jsonb_build_object(
    'priceStaffedCents', coalesce((SELECT b.price_cents FROM product_location_prices b WHERE b.tenant_id = l.tenant_id AND b.product_id = p.id AND b.location_id = o.location_id AND b.service_mode = 'staffed'), p.price_staffed_cents),
    'pricePickupCents', coalesce((SELECT b.price_cents FROM product_location_prices b WHERE b.tenant_id = l.tenant_id AND b.product_id = p.id AND b.location_id = o.location_id AND b.service_mode = 'pickup'), p.price_pickup_cents),
    'priceDropoffCents', coalesce((SELECT b.price_cents FROM product_location_prices b WHERE b.tenant_id = l.tenant_id AND b.product_id = p.id AND b.location_id = o.location_id AND b.service_mode = 'dropoff'), p.price_dropoff_cents),
    'baseHours', p.base_hours, 'hourlyRateCents', p.hourly_rate_cents,
    'overtimeBlockMinutes', p.overtime_block_minutes, 'overtimeBlockCents', p.overtime_block_cents, 'minHours', p.min_hours)
  FROM orders o, products p
  WHERE l.pricing IS NULL AND o.tenant_id = l.tenant_id AND o.id = l.order_id AND p.tenant_id = l.tenant_id AND p.id = l.product_id;
