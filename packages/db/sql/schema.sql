CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "account" ENABLE ROW LEVEL SECURITY;
CREATE TABLE "admin_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_id" text NOT NULL,
	"user_id" text NOT NULL,
	"action" text NOT NULL,
	"details" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "admin_audit" ENABLE ROW LEVEL SECURITY;
CREATE TABLE "merchant" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"user_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_slug_unique" UNIQUE("slug"),
	CONSTRAINT "merchant_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "merchant_id_format" CHECK ("merchant"."id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "merchant_slug_format" CHECK ("merchant"."slug" ~ '^[a-z][a-z0-9-]{2,31}$'),
	CONSTRAINT "merchant_name_length" CHECK (length(trim("merchant"."name")) BETWEEN 1 AND 100)
);

ALTER TABLE "merchant" ENABLE ROW LEVEL SECURITY;
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
	"settlement_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_tenant_id" UNIQUE("merchant_id","id"),
	CONSTRAINT "order_idempotency" UNIQUE("merchant_id","idempotency_key"),
	CONSTRAINT "order_usd" CHECK ("payment_order"."amount_usd_cents" BETWEEN 1000 AND 30000),
	CONSTRAINT "order_sats" CHECK ("payment_order"."amount_sat" BETWEEN 1 AND 9007199254740),
	CONSTRAINT "order_reference" CHECK (length("payment_order"."reference") <= 128),
	CONSTRAINT "order_rate" CHECK ("payment_order"."rate_usd" ~ '^[0-9]+([.][0-9]+)?$' AND "payment_order"."rate_usd"::numeric > 0),
	CONSTRAINT "order_status" CHECK ("payment_order"."status" IN ('creating','pending','paid','expired','failed')),
	CONSTRAINT "order_invoice_consistency" CHECK (("payment_order"."invoice" IS NULL AND "payment_order"."payment_hash" IS NULL AND "payment_order"."expires_at" IS NULL AND "payment_order"."status" IN ('creating','failed')) OR ("payment_order"."invoice" IS NOT NULL AND "payment_order"."payment_hash" IS NOT NULL AND "payment_order"."payment_hash" ~ '^[0-9a-f]{64}$' AND "payment_order"."expires_at" IS NOT NULL AND "payment_order"."status" IN ('pending','paid','expired'))),
	CONSTRAINT "order_paid_consistency" CHECK (("payment_order"."status" = 'paid' AND "payment_order"."paid_at" IS NOT NULL AND "payment_order"."payment_hash" IS NOT NULL AND "payment_order"."received_msat" IS NOT NULL AND "payment_order"."received_msat" > 0 AND "payment_order"."received_msat" = "payment_order"."amount_sat" * 1000) OR ("payment_order"."status" <> 'paid' AND "payment_order"."paid_at" IS NULL AND "payment_order"."received_msat" IS NULL)),
	CONSTRAINT "order_settled_paid" CHECK ("payment_order"."settlement_id" IS NULL OR "payment_order"."status" = 'paid')
);

ALTER TABLE "payment_order" ENABLE ROW LEVEL SECURITY;
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"impersonated_by" text,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);

ALTER TABLE "session" ENABLE ROW LEVEL SECURITY;
CREATE TABLE "settlement" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"amount_sat" bigint NOT NULL,
	"proof" text,
	"status" text NOT NULL,
	"order_count" integer NOT NULL,
	"cutoff_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"confirmed_by" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" text,
	"cancel_reason" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlement_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "settlement_tenant_id" UNIQUE("merchant_id","id"),
	CONSTRAINT "settlement_count" CHECK ("settlement"."order_count" > 0),
	CONSTRAINT "settlement_state" CHECK (("settlement"."status" = 'pending' AND "settlement"."cutoff_at" IS NOT NULL AND "settlement"."proof" IS NULL AND "settlement"."confirmed_at" IS NULL AND "settlement"."confirmed_by" IS NULL AND "settlement"."cancelled_at" IS NULL AND "settlement"."cancelled_by" IS NULL AND "settlement"."cancel_reason" IS NULL) OR ("settlement"."status" = 'settled' AND "settlement"."proof" IS NOT NULL AND "settlement"."confirmed_at" IS NOT NULL AND "settlement"."confirmed_by" IS NOT NULL AND "settlement"."cancelled_at" IS NULL AND "settlement"."cancelled_by" IS NULL AND "settlement"."cancel_reason" IS NULL) OR ("settlement"."status" = 'cancelled' AND "settlement"."cutoff_at" IS NOT NULL AND "settlement"."proof" IS NULL AND "settlement"."confirmed_at" IS NULL AND "settlement"."confirmed_by" IS NULL AND "settlement"."cancelled_at" IS NOT NULL AND "settlement"."cancelled_by" IS NOT NULL AND length(trim("settlement"."cancel_reason")) BETWEEN 1 AND 500 AND "settlement"."cancel_reason" IS NOT NULL)),
	CONSTRAINT "settlement_amount" CHECK ("settlement"."amount_sat" > 0 AND "settlement"."amount_sat" <= 2100000000000000),
	CONSTRAINT "settlement_proof" CHECK (length("settlement"."proof") BETWEEN 1 AND 1000)
);

ALTER TABLE "settlement" ENABLE ROW LEVEL SECURITY;
CREATE TABLE "settlement_item" (
	"settlement_id" uuid NOT NULL,
	"merchant_id" text NOT NULL,
	"order_id" uuid NOT NULL,
	"amount_sat" bigint NOT NULL,
	CONSTRAINT "settlement_item_settlement_id_order_id_pk" PRIMARY KEY("settlement_id","order_id"),
	CONSTRAINT "settlement_item_amount" CHECK ("settlement_item"."amount_sat" > 0 AND "settlement_item"."amount_sat" <= 9007199254740)
);

ALTER TABLE "settlement_item" ENABLE ROW LEVEL SECURITY;
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" text DEFAULT 'merchant' NOT NULL,
	"banned" boolean DEFAULT false NOT NULL,
	"ban_reason" text,
	"ban_expires" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email"),
	CONSTRAINT "user_email_normalized" CHECK ("user"."email" = lower(trim("user"."email"))),
	CONSTRAINT "user_role" CHECK ("user"."role" IN ('admin', 'merchant'))
);

ALTER TABLE "user" ENABLE ROW LEVEL SECURITY;
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "verification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "admin_audit" ADD CONSTRAINT "admin_audit_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "admin_audit" ADD CONSTRAINT "admin_audit_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "merchant" ADD CONSTRAINT "merchant_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "payment_order" ADD CONSTRAINT "payment_order_merchant_id_merchant_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchant"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "payment_order" ADD CONSTRAINT "order_settlement_tenant" FOREIGN KEY ("merchant_id","settlement_id") REFERENCES "public"."settlement"("merchant_id","id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "settlement" ADD CONSTRAINT "settlement_merchant_id_merchant_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchant"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "settlement" ADD CONSTRAINT "settlement_confirmed_by_user_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "settlement" ADD CONSTRAINT "settlement_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "settlement" ADD CONSTRAINT "settlement_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "settlement_item" ADD CONSTRAINT "settlement_item_batch_fk" FOREIGN KEY ("merchant_id","settlement_id") REFERENCES "public"."settlement"("merchant_id","id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "settlement_item" ADD CONSTRAINT "settlement_item_order_fk" FOREIGN KEY ("merchant_id","order_id") REFERENCES "public"."payment_order"("merchant_id","id") ON DELETE restrict ON UPDATE no action;
CREATE INDEX "account_user_idx" ON "account" USING btree ("user_id");
CREATE UNIQUE INDEX "account_provider_identity_idx" ON "account" USING btree ("provider_id","account_id");
CREATE INDEX "admin_audit_actor_idx" ON "admin_audit" USING btree ("actor_id");
CREATE INDEX "admin_audit_user_idx" ON "admin_audit" USING btree ("user_id");
CREATE INDEX "order_settlement_candidates" ON "payment_order" USING btree ("merchant_id","paid_at","id") WHERE "payment_order"."status" = 'paid' AND "payment_order"."settlement_id" IS NULL;
CREATE UNIQUE INDEX "order_payment_hash" ON "payment_order" USING btree ("payment_hash");
CREATE INDEX "order_merchant_created" ON "payment_order" USING btree ("merchant_id","created_at");
CREATE INDEX "order_created" ON "payment_order" USING btree ("created_at");
CREATE INDEX "order_settlement" ON "payment_order" USING btree ("merchant_id","settlement_id");
CREATE INDEX "order_recovery" ON "payment_order" USING btree ("attempted_at","id") WHERE "payment_order"."status" IN ('creating','pending');
CREATE INDEX "session_user_idx" ON "session" USING btree ("user_id");
CREATE INDEX "settlement_confirmer_idx" ON "settlement" USING btree ("confirmed_by");
CREATE INDEX "settlement_canceller_idx" ON "settlement" USING btree ("cancelled_by");
CREATE INDEX "settlement_creator_idx" ON "settlement" USING btree ("created_by");
CREATE INDEX "settlement_merchant_created_idx" ON "settlement" USING btree ("merchant_id","created_at");
CREATE INDEX "settlement_item_order_idx" ON "settlement_item" USING btree ("merchant_id","order_id");
CREATE INDEX "settlement_item_batch_idx" ON "settlement_item" USING btree ("merchant_id","settlement_id");
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");
CREATE POLICY "admin_audit_access" ON "admin_audit" AS PERMISSIVE FOR ALL TO public USING (current_setting('app.payment_admin', true) = 'true') WITH CHECK (current_setting('app.payment_admin', true) = 'true');
CREATE POLICY "merchant_access" ON "merchant" AS PERMISSIVE FOR ALL TO public USING (current_setting('app.payment_admin', true) = 'true' OR "merchant"."id" = nullif(current_setting('app.merchant_id', true), '') OR "merchant"."slug" = nullif(current_setting('app.merchant_slug', true), '')) WITH CHECK (current_setting('app.payment_admin', true) = 'true');
CREATE POLICY "order_access" ON "payment_order" AS PERMISSIVE FOR ALL TO public USING (current_setting('app.payment_admin', true) = 'true' OR "payment_order"."merchant_id" = nullif(current_setting('app.merchant_id', true), '') OR "payment_order"."id"::text = nullif(current_setting('app.order_id', true), '')) WITH CHECK (current_setting('app.payment_admin', true) = 'true' OR "payment_order"."merchant_id" = nullif(current_setting('app.merchant_id', true), ''));
CREATE POLICY "settlement_access" ON "settlement" AS PERMISSIVE FOR ALL TO public USING (current_setting('app.payment_admin', true) = 'true') WITH CHECK (current_setting('app.payment_admin', true) = 'true');
CREATE POLICY "settlement_item_access" ON "settlement_item" AS PERMISSIVE FOR ALL TO public USING (current_setting('app.payment_admin', true) = 'true') WITH CHECK (current_setting('app.payment_admin', true) = 'true');
ALTER TABLE public."admin_audit" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."user" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."session" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."account" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."verification" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."merchant" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."payment_order" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."settlement" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."settlement_item" FORCE ROW LEVEL SECURITY;
-- Greenfield baseline invariants, included by generate.ts.
CREATE FUNCTION preserve_user_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.role IS DISTINCT FROM OLD.role OR NEW.email IS DISTINCT FROM OLD.email THEN
    RAISE EXCEPTION 'User role and email are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER user_identity_immutable BEFORE UPDATE ON public."user"
FOR EACH ROW EXECUTE FUNCTION preserve_user_identity();
CREATE FUNCTION preserve_merchant_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.slug IS DISTINCT FROM OLD.slug OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'Merchant identity is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER merchant_identity_immutable BEFORE UPDATE ON public.merchant
FOR EACH ROW EXECUTE FUNCTION preserve_merchant_identity();

CREATE FUNCTION check_merchant_user() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public."user" WHERE id = NEW.user_id AND role = 'merchant' AND banned = NOT NEW.enabled) THEN
    RAISE EXCEPTION 'Merchant requires an associated merchant account' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER merchant_user_role BEFORE INSERT ON public.merchant
FOR EACH ROW EXECUTE FUNCTION check_merchant_user();

-- Serialize session insertion with disabling, so restoring cannot revive a raced session.
CREATE FUNCTION check_session_login() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE allowed boolean;
BEGIN
  SELECT role = 'admin' AND NOT banned INTO allowed FROM public."user"
  WHERE id = NEW.user_id FOR SHARE;
  IF allowed IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Login unavailable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER session_login_allowed BEFORE INSERT ON public.session
FOR EACH ROW EXECUTE FUNCTION check_session_login();
