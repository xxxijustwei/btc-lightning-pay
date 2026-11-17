SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '30s';
--> statement-breakpoint
CREATE TABLE "merchant" (
	"id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_id_format" CHECK ("merchant"."id" ~ '^[a-z][a-z0-9-]{2,31}$')
);
--> statement-breakpoint
ALTER TABLE "merchant" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payment_order" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"amount_usd_cents" integer NOT NULL,
	"amount_sat" bigint NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"rate_usd" text NOT NULL,
	"quoted_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'creating' NOT NULL,
	"invoice" text,
	"payment_hash" text,
	"expires_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"received_msat" bigint,
	"fee_msat" bigint,
	"settlement_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_idempotency" UNIQUE("merchant_id","idempotency_key"),
	CONSTRAINT "order_usd" CHECK ("payment_order"."amount_usd_cents" BETWEEN 1000 AND 30000),
	CONSTRAINT "order_sats" CHECK ("payment_order"."amount_sat" BETWEEN 1 AND 2100000000000000),
	CONSTRAINT "order_reference" CHECK (length("payment_order"."reference") <= 128),
	CONSTRAINT "order_rate" CHECK ("payment_order"."rate_usd" ~ '^[0-9]+([.][0-9]+)?$' AND "payment_order"."rate_usd"::numeric > 0),
	CONSTRAINT "order_status" CHECK ("payment_order"."status" IN ('creating','pending','paid','expired','failed')),
	CONSTRAINT "order_invoice_consistency" CHECK (("payment_order"."invoice" IS NULL AND "payment_order"."payment_hash" IS NULL AND "payment_order"."expires_at" IS NULL) OR ("payment_order"."invoice" IS NOT NULL AND "payment_order"."payment_hash" ~ '^[0-9a-f]{64}$' AND "payment_order"."expires_at" IS NOT NULL)),
	CONSTRAINT "order_paid_consistency" CHECK (("payment_order"."status" = 'paid' AND "payment_order"."paid_at" IS NOT NULL AND "payment_order"."payment_hash" IS NOT NULL AND "payment_order"."received_msat" >= 0 AND "payment_order"."fee_msat" >= 0 AND "payment_order"."received_msat" + "payment_order"."fee_msat" = "payment_order"."amount_sat" * 1000) OR ("payment_order"."status" <> 'paid' AND "payment_order"."paid_at" IS NULL AND "payment_order"."received_msat" IS NULL AND "payment_order"."fee_msat" IS NULL)),
	CONSTRAINT "order_settled_paid" CHECK ("payment_order"."settlement_id" IS NULL OR "payment_order"."status" = 'paid')
);
--> statement-breakpoint
ALTER TABLE "payment_order" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "settlement" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"amount_sat" bigint NOT NULL,
	"proof" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlement_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "settlement_tenant_id" UNIQUE("merchant_id","id"),
	CONSTRAINT "settlement_amount" CHECK ("settlement"."amount_sat" > 0 AND "settlement"."amount_sat" <= 2100000000000000),
	CONSTRAINT "settlement_proof" CHECK (length("settlement"."proof") BETWEEN 1 AND 1000)
);
--> statement-breakpoint
ALTER TABLE "settlement" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payment_order" ADD CONSTRAINT "payment_order_merchant_id_merchant_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_order" ADD CONSTRAINT "order_settlement_tenant" FOREIGN KEY ("merchant_id","settlement_id") REFERENCES "public"."settlement"("merchant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement" ADD CONSTRAINT "settlement_merchant_id_merchant_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement" ADD CONSTRAINT "settlement_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "order_payment_hash" ON "payment_order" USING btree ("payment_hash");--> statement-breakpoint
CREATE INDEX "order_merchant_created" ON "payment_order" USING btree ("merchant_id","created_at");--> statement-breakpoint
CREATE INDEX "order_created" ON "payment_order" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "order_settlement" ON "payment_order" USING btree ("merchant_id","settlement_id");--> statement-breakpoint
CREATE INDEX "settlement_creator_idx" ON "settlement" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "settlement_merchant_created_idx" ON "settlement" USING btree ("merchant_id","created_at");--> statement-breakpoint
CREATE POLICY "merchant_access" ON "merchant" AS PERMISSIVE FOR ALL TO public USING (current_setting('app.payment_admin', true) = 'true' OR "merchant"."id" = nullif(current_setting('app.merchant_id', true), '')) WITH CHECK (current_setting('app.payment_admin', true) = 'true');--> statement-breakpoint
CREATE POLICY "order_access" ON "payment_order" AS PERMISSIVE FOR ALL TO public USING (current_setting('app.payment_admin', true) = 'true' OR "payment_order"."merchant_id" = nullif(current_setting('app.merchant_id', true), '') OR "payment_order"."id"::text = nullif(current_setting('app.order_id', true), '')) WITH CHECK (current_setting('app.payment_admin', true) = 'true' OR "payment_order"."merchant_id" = nullif(current_setting('app.merchant_id', true), ''));--> statement-breakpoint
CREATE POLICY "settlement_access" ON "settlement" AS PERMISSIVE FOR ALL TO public USING (current_setting('app.payment_admin', true) = 'true') WITH CHECK (current_setting('app.payment_admin', true) = 'true');
--> statement-breakpoint
ALTER TABLE merchant FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE payment_order FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE settlement FORCE ROW LEVEL SECURITY;
