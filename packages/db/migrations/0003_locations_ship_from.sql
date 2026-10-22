-- A location and its warehouse are the same thing: the place equipment ships
-- from. Fold warehouses into locations without losing any data.

ALTER TABLE "locations" ADD COLUMN "loading_notes" text;
--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "is_primary" boolean DEFAULT false NOT NULL;
--> statement-breakpoint

-- 1. Each location takes its primary warehouse's address, pin and notes
--    (the warehouse is where the equipment actually is).
UPDATE locations l
SET line1 = w.line1, line2 = w.line2, city = w.city, region = w.region, postal_code = w.postal_code,
    country = w.country, lat = coalesce(w.lat, l.lat), lng = coalesce(w.lng, l.lng),
    phone = coalesce(l.phone, w.phone), loading_notes = w.loading_notes
FROM warehouses w
WHERE w.tenant_id = l.tenant_id AND w.location_id = l.id AND w.is_primary;
--> statement-breakpoint

-- 2. Any other warehouse becomes a location of its own (same tax rate as its old parent).
WITH extra AS (
  SELECT w.*, l.timezone, l.code AS parent_code,
         row_number() OVER (PARTITION BY w.tenant_id, w.location_id ORDER BY w.created_at) + 1 AS n
  FROM warehouses w JOIN locations l ON l.tenant_id = w.tenant_id AND l.id = w.location_id
  WHERE NOT w.is_primary
), inserted AS (
  INSERT INTO locations (tenant_id, name, code, timezone, phone, line1, line2, city, region, postal_code, country, lat, lng, loading_notes, is_active)
  SELECT tenant_id, name, left(parent_code, 6) || n, timezone, phone, line1, line2, city, region, postal_code, country, lat, lng, loading_notes, is_active
  FROM extra
  RETURNING tenant_id, id, code
)
INSERT INTO tax_rates (tenant_id, location_id, name, rate, is_default)
SELECT i.tenant_id, i.id, t.name, t.rate, true
FROM inserted i
JOIN extra e ON e.tenant_id = i.tenant_id AND left(e.parent_code, 6) || e.n = i.code
JOIN tax_rates t ON t.tenant_id = e.tenant_id AND t.location_id = e.location_id AND t.is_default;
--> statement-breakpoint

-- 3. One primary location per organization: the oldest.
UPDATE locations l SET is_primary = true
FROM (SELECT DISTINCT ON (tenant_id) tenant_id, id FROM locations ORDER BY tenant_id, created_at, id) first
WHERE l.tenant_id = first.tenant_id AND l.id = first.id;
--> statement-breakpoint

DROP TABLE "warehouses" CASCADE;
