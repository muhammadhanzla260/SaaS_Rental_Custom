-- Phase 2b: isolation for invoices, saved cards and signatures. A signature is a record: never rewritten.

SELECT app_enable_tenant_rls(t::regclass) FROM unnest(ARRAY['invoices','payment_methods','signatures']) AS t;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON signatures FROM rental_app;
