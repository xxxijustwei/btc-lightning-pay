SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '30s';
--> statement-breakpoint
ALTER TABLE "payment_order" DROP CONSTRAINT "order_paid_consistency";--> statement-breakpoint
ALTER TABLE "payment_order" ADD COLUMN "attempted_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_order" ADD CONSTRAINT "order_paid_consistency" CHECK (("payment_order"."status" = 'paid' AND "payment_order"."paid_at" IS NOT NULL AND "payment_order"."payment_hash" IS NOT NULL AND "payment_order"."received_msat" IS NOT NULL AND "payment_order"."fee_msat" IS NOT NULL AND "payment_order"."received_msat" > 0 AND "payment_order"."fee_msat" >= 0 AND "payment_order"."received_msat" + "payment_order"."fee_msat" = "payment_order"."amount_sat" * 1000) OR ("payment_order"."status" <> 'paid' AND "payment_order"."paid_at" IS NULL AND "payment_order"."received_msat" IS NULL AND "payment_order"."fee_msat" IS NULL));