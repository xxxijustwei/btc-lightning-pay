SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '30s';
--> statement-breakpoint
ALTER TABLE "payment_order" DROP CONSTRAINT "order_sats";--> statement-breakpoint
ALTER TABLE "payment_order" DROP CONSTRAINT "order_invoice_consistency";--> statement-breakpoint
CREATE INDEX "order_recovery" ON "payment_order" USING btree ("attempted_at","id") WHERE "payment_order"."status" = 'creating';--> statement-breakpoint
ALTER TABLE "payment_order" ADD CONSTRAINT "order_sats" CHECK ("payment_order"."amount_sat" BETWEEN 1 AND 9007199254740);--> statement-breakpoint
ALTER TABLE "payment_order" ADD CONSTRAINT "order_invoice_consistency" CHECK (("payment_order"."invoice" IS NULL AND "payment_order"."payment_hash" IS NULL AND "payment_order"."expires_at" IS NULL AND "payment_order"."status" IN ('creating','failed')) OR ("payment_order"."invoice" IS NOT NULL AND "payment_order"."payment_hash" IS NOT NULL AND "payment_order"."payment_hash" ~ '^[0-9a-f]{64}$' AND "payment_order"."expires_at" IS NOT NULL AND "payment_order"."status" IN ('pending','paid','expired')));
