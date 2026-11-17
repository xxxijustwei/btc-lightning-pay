SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '60s';
--> statement-breakpoint
SELECT set_config('app.payment_admin','true',true);
--> statement-breakpoint
CREATE TABLE "settlement_item" (
	"settlement_id" uuid NOT NULL,
	"merchant_id" text NOT NULL,
	"order_id" uuid NOT NULL,
	"amount_sat" bigint NOT NULL,
	CONSTRAINT "settlement_item_settlement_id_order_id_pk" PRIMARY KEY("settlement_id","order_id"),
	CONSTRAINT "settlement_item_amount" CHECK ("settlement_item"."amount_sat" > 0 AND "settlement_item"."amount_sat" <= 9007199254740)
);
--> statement-breakpoint
ALTER TABLE "settlement_item" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "settlement" ALTER COLUMN "proof" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "settlement" ADD COLUMN "status" text;--> statement-breakpoint
ALTER TABLE "settlement" ADD COLUMN "order_count" integer;--> statement-breakpoint
ALTER TABLE "settlement" ADD COLUMN "cutoff_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "settlement" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "settlement" ADD COLUMN "confirmed_by" text;--> statement-breakpoint
ALTER TABLE "settlement" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "settlement" ADD COLUMN "cancelled_by" text;--> statement-breakpoint
ALTER TABLE "settlement" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "payment_order" ADD CONSTRAINT "order_tenant_id" UNIQUE("merchant_id","id");--> statement-breakpoint
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM settlement s LEFT JOIN payment_order o ON o.settlement_id=s.id GROUP BY s.id HAVING count(o.id)=0 OR sum(o.amount_sat)<>s.amount_sat) THEN
  RAISE EXCEPTION 'Settlement history does not reconcile; migration aborted';
 END IF;
END $$;
--> statement-breakpoint
UPDATE settlement s SET status='settled', confirmed_at=created_at, confirmed_by=created_by, order_count=(SELECT count(*) FROM payment_order o WHERE o.settlement_id=s.id);
--> statement-breakpoint
INSERT INTO settlement_item(settlement_id,merchant_id,order_id,amount_sat) SELECT settlement_id,merchant_id,id,amount_sat FROM payment_order WHERE settlement_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE settlement ALTER COLUMN status SET NOT NULL, ALTER COLUMN order_count SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "settlement_item" ADD CONSTRAINT "settlement_item_batch_fk" FOREIGN KEY ("merchant_id","settlement_id") REFERENCES "public"."settlement"("merchant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_item" ADD CONSTRAINT "settlement_item_order_fk" FOREIGN KEY ("merchant_id","order_id") REFERENCES "public"."payment_order"("merchant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "settlement_item_order_idx" ON "settlement_item" USING btree ("merchant_id","order_id");--> statement-breakpoint
CREATE INDEX "settlement_item_batch_idx" ON "settlement_item" USING btree ("merchant_id","settlement_id");--> statement-breakpoint
ALTER TABLE "settlement" ADD CONSTRAINT "settlement_confirmed_by_user_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement" ADD CONSTRAINT "settlement_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_settlement_candidates" ON "payment_order" USING btree ("merchant_id","paid_at","id") WHERE "payment_order"."status" = 'paid' AND "payment_order"."settlement_id" IS NULL;--> statement-breakpoint
CREATE INDEX "settlement_confirmer_idx" ON "settlement" USING btree ("confirmed_by");--> statement-breakpoint
CREATE INDEX "settlement_canceller_idx" ON "settlement" USING btree ("cancelled_by");--> statement-breakpoint
ALTER TABLE "settlement" ADD CONSTRAINT "settlement_count" CHECK ("settlement"."order_count" > 0);--> statement-breakpoint
ALTER TABLE "settlement" ADD CONSTRAINT "settlement_state" CHECK (("settlement"."status" = 'pending' AND "settlement"."cutoff_at" IS NOT NULL AND "settlement"."proof" IS NULL AND "settlement"."confirmed_at" IS NULL AND "settlement"."confirmed_by" IS NULL AND "settlement"."cancelled_at" IS NULL AND "settlement"."cancelled_by" IS NULL AND "settlement"."cancel_reason" IS NULL) OR ("settlement"."status" = 'settled' AND "settlement"."proof" IS NOT NULL AND "settlement"."confirmed_at" IS NOT NULL AND "settlement"."confirmed_by" IS NOT NULL AND "settlement"."cancelled_at" IS NULL AND "settlement"."cancelled_by" IS NULL AND "settlement"."cancel_reason" IS NULL) OR ("settlement"."status" = 'cancelled' AND "settlement"."cutoff_at" IS NOT NULL AND "settlement"."proof" IS NULL AND "settlement"."confirmed_at" IS NULL AND "settlement"."confirmed_by" IS NULL AND "settlement"."cancelled_at" IS NOT NULL AND "settlement"."cancelled_by" IS NOT NULL AND length(trim("settlement"."cancel_reason")) BETWEEN 1 AND 500 AND "settlement"."cancel_reason" IS NOT NULL));--> statement-breakpoint
CREATE POLICY "settlement_item_access" ON "settlement_item" AS PERMISSIVE FOR ALL TO public USING (current_setting('app.payment_admin', true) = 'true') WITH CHECK (current_setting('app.payment_admin', true) = 'true');
--> statement-breakpoint
ALTER TABLE settlement_item FORCE ROW LEVEL SECURITY;
