ALTER TABLE "refunds" DROP CONSTRAINT "refunds_status";--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_status" CHECK ("refunds"."status" in ('pending','done','owed','void'));--> statement-breakpoint
-- Refunds stay records that are never rewritten: the app role may only move a refund along
-- (pending -> done or void, owed -> done) and keep the gateway's refund id; amounts and numbers stay as written.
GRANT UPDATE (status, gateway_ref, reason) ON refunds TO rental_app;
