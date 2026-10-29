ALTER TABLE "invoices" DROP CONSTRAINT "invoices_number";--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payments_number";--> statement-breakpoint
-- One invoice per order: keep each order's earliest live invoice, move its payments onto it, drop the rest.
-- (Amounts, paid and due dates are recomputed from the order by syncInvoices; scripts/resync-invoices.ts.)
CREATE TEMP TABLE invoice_keep ON COMMIT DROP AS
  SELECT tenant_id, order_id, (array_agg(id ORDER BY (status = 'void'), created_at, id))[1] AS keep_id
  FROM invoices GROUP BY tenant_id, order_id;--> statement-breakpoint
UPDATE payments p SET invoice_id = k.keep_id
  FROM invoices i JOIN invoice_keep k ON k.tenant_id = i.tenant_id AND k.order_id = i.order_id
  WHERE p.tenant_id = i.tenant_id AND p.invoice_id = i.id AND i.id <> k.keep_id;--> statement-breakpoint
DELETE FROM invoices i USING invoice_keep k
  WHERE k.tenant_id = i.tenant_id AND k.order_id = i.order_id AND i.id <> k.keep_id;--> statement-breakpoint
-- Invoices and receipts carry the order's number.
UPDATE invoices i SET number = o.number, kind = 'full' FROM orders o WHERE o.tenant_id = i.tenant_id AND o.id = i.order_id;--> statement-breakpoint
UPDATE payments p SET number = o.number FROM orders o WHERE o.tenant_id = p.tenant_id AND o.id = p.order_id;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_one_per_order" ON "invoices" USING btree ("tenant_id","order_id");--> statement-breakpoint
CREATE INDEX "payments_number_idx" ON "payments" USING btree ("tenant_id","number");
