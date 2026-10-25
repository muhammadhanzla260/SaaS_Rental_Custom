-- Odoo's payment confirmations replace the single "receipt" message type:
-- payment_partial while money is still owed after the payment, payment_paid once paid in full.

-- Logged messages: decide by what was paid up to and including that payment.
UPDATE messages m
SET type = CASE
  WHEN (
    SELECT coalesce(sum(p2.amount_cents), 0)
    FROM payments p2
    WHERE p2.tenant_id = p.tenant_id AND p2.order_id = p.order_id AND p2.status = 'received'
      AND (p2.received_at, p2.id) <= (p.received_at, p.id)
  ) >= o.total_cents THEN 'payment_paid'
  ELSE 'payment_partial'
END
FROM payments p
JOIN orders o ON o.tenant_id = p.tenant_id AND o.id = p.order_id
WHERE m.type = 'receipt'
  AND p.tenant_id = m.tenant_id
  AND p.id::text = m.meta->>'paymentId';
--> statement-breakpoint
UPDATE messages SET type = 'payment_partial' WHERE type = 'receipt';
--> statement-breakpoint

-- A customised receipt template carries over to both new types.
INSERT INTO message_templates (tenant_id, type, channel, subject, body, button_text, mode, raw_source, raw_kind, attach_document, attach_agreement, tracking, auto_plain_text, version, updated_by_name)
SELECT tenant_id, t.new_type, channel, subject, body, button_text, mode, raw_source, raw_kind, attach_document, attach_agreement, tracking, auto_plain_text, version, updated_by_name
FROM message_templates
CROSS JOIN (VALUES ('payment_partial'), ('payment_paid')) AS t(new_type)
WHERE type = 'receipt'
ON CONFLICT ON CONSTRAINT message_templates_type DO NOTHING;
--> statement-breakpoint
DELETE FROM message_templates WHERE type = 'receipt';
--> statement-breakpoint

-- "Payment receipt" switched off stays off for both.
UPDATE tenants
SET settings = jsonb_set(
  jsonb_set(settings, '{messaging,instant,payment_partial}', settings #> '{messaging,instant,receipt}'),
  '{messaging,instant,payment_paid}', settings #> '{messaging,instant,receipt}')
WHERE settings #> '{messaging,instant,receipt}' IS NOT NULL;
