CREATE TABLE "settlement_payout" (
	"id" uuid PRIMARY KEY NOT NULL,
	"settlement_id" uuid NOT NULL,
	"merchant_id" text NOT NULL,
	"amount_sat" bigint NOT NULL,
	"chain" text NOT NULL,
	"chain_id" text,
	"asset" text NOT NULL,
	"asset_contract" text,
	"asset_decimals" integer NOT NULL,
	"address" text NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text NOT NULL,
	"quote_expires_at" timestamp with time zone NOT NULL,
	"value_out" text NOT NULL,
	"fee_out" text NOT NULL,
	"estimated_out" text NOT NULL,
	"status" text NOT NULL,
	"payment_id" text,
	"delivered_out" text,
	"external_tx" text,
	"not_sent_reason" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_by" text,
	"submitted_at" timestamp with time zone,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "settlement_payout_status" CHECK ("settlement_payout"."status" IN ('quoted','expired','submitting','pending','completed','refunded','failed','not_sent')),
	CONSTRAINT "settlement_payout_amount" CHECK ("settlement_payout"."amount_sat" > 0 AND "settlement_payout"."amount_sat" <= 2100000000000000),
	CONSTRAINT "settlement_payout_asset" CHECK ("settlement_payout"."asset" IN ('USDC','USDT')),
	CONSTRAINT "settlement_payout_provider" CHECK ("settlement_payout"."provider" IN ('orchestra','boltz')),
	CONSTRAINT "settlement_payout_chain" CHECK ("settlement_payout"."chain" ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
	CONSTRAINT "settlement_payout_decimals" CHECK ("settlement_payout"."asset_decimals" BETWEEN 0 AND 36),
	CONSTRAINT "settlement_payout_address" CHECK ("settlement_payout"."address" ~ '^[0-9A-Za-z]{20,64}$'),
	CONSTRAINT "settlement_payout_units" CHECK ("settlement_payout"."value_out" ~ '^(0|[1-9][0-9]{0,39})$' AND "settlement_payout"."fee_out" ~ '^(0|[1-9][0-9]{0,39})$' AND "settlement_payout"."estimated_out" ~ '^(0|[1-9][0-9]{0,39})$' AND ("settlement_payout"."delivered_out" IS NULL OR "settlement_payout"."delivered_out" ~ '^(0|[1-9][0-9]{0,39})$')),
	CONSTRAINT "settlement_payout_submitted" CHECK (("settlement_payout"."status" IN ('quoted') AND "settlement_payout"."submitted_at" IS NULL AND "settlement_payout"."submitted_by" IS NULL) OR ("settlement_payout"."status" IN ('submitting','pending','completed','refunded','not_sent') AND "settlement_payout"."submitted_at" IS NOT NULL AND "settlement_payout"."submitted_by" IS NOT NULL) OR "settlement_payout"."status" IN ('expired','failed')),
	CONSTRAINT "settlement_payout_payment" CHECK ("settlement_payout"."status" NOT IN ('pending','completed','refunded') OR "settlement_payout"."payment_id" IS NOT NULL),
	CONSTRAINT "settlement_payout_delivered" CHECK (("settlement_payout"."status" = 'completed' AND "settlement_payout"."delivered_out" IS NOT NULL) OR ("settlement_payout"."status" <> 'completed' AND "settlement_payout"."delivered_out" IS NULL AND "settlement_payout"."external_tx" IS NULL)),
	CONSTRAINT "settlement_payout_resolved" CHECK (("settlement_payout"."status" IN ('completed','refunded','failed','not_sent')) = ("settlement_payout"."resolved_at" IS NOT NULL)),
	CONSTRAINT "settlement_payout_not_sent" CHECK (("settlement_payout"."status" = 'not_sent' AND "settlement_payout"."resolved_by" IS NOT NULL AND length(trim("settlement_payout"."not_sent_reason")) BETWEEN 1 AND 500) OR ("settlement_payout"."status" <> 'not_sent' AND "settlement_payout"."resolved_by" IS NULL AND "settlement_payout"."not_sent_reason" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "settlement_payout" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "settlement_payout" ADD CONSTRAINT "settlement_payout_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_payout" ADD CONSTRAINT "settlement_payout_submitted_by_user_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_payout" ADD CONSTRAINT "settlement_payout_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_payout" ADD CONSTRAINT "settlement_payout_batch_fk" FOREIGN KEY ("merchant_id","settlement_id") REFERENCES "public"."settlement"("merchant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "settlement_payout_batch_idx" ON "settlement_payout" USING btree ("settlement_id","created_at");--> statement-breakpoint
CREATE INDEX "settlement_payout_creator_idx" ON "settlement_payout" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "settlement_payout_submitter_idx" ON "settlement_payout" USING btree ("submitted_by");--> statement-breakpoint
CREATE INDEX "settlement_payout_resolver_idx" ON "settlement_payout" USING btree ("resolved_by");--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_payout_quoted_idx" ON "settlement_payout" USING btree ("settlement_id") WHERE "settlement_payout"."status" = 'quoted';--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_payout_active_idx" ON "settlement_payout" USING btree ("settlement_id") WHERE "settlement_payout"."status" IN ('submitting','pending');--> statement-breakpoint
CREATE INDEX "settlement_payout_open_idx" ON "settlement_payout" USING btree ("status") WHERE "settlement_payout"."status" IN ('quoted','submitting','pending');--> statement-breakpoint
CREATE POLICY "settlement_payout_access" ON "settlement_payout" AS PERMISSIVE FOR ALL TO public USING (current_setting('app.payment_admin', true) = 'true') WITH CHECK (current_setting('app.payment_admin', true) = 'true');--> statement-breakpoint
ALTER TABLE public."settlement_payout" FORCE ROW LEVEL SECURITY;