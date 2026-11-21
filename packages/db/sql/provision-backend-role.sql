-- Run as the database owner after schema initialization. Set this login's password securely
-- in the database console, then use it in DATABASE_URL / Hyperdrive.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'btc_backend') THEN
    CREATE ROLE btc_backend LOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
-- Supabase's postgres role cannot ALTER BYPASSRLS; verify existing roles instead.
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'btc_backend' AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'btc_backend must not be superuser or bypass RLS';
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO btc_backend;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."user", public.session, public.account, public.verification, public.rate_limit, public.otp_throttle TO btc_backend;
GRANT SELECT, INSERT, UPDATE ON public.merchant, public.settlement, public.settlement_payout TO btc_backend;
-- DELETE releases an order reservation whose invoice could not be issued.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_order TO btc_backend;
GRANT SELECT, INSERT, UPDATE ON public.wallet_sync_cursor TO btc_backend;

GRANT SELECT, INSERT ON public.admin_audit, public.settlement_item TO btc_backend;
GRANT SELECT, INSERT, UPDATE ON public.btc_quote TO btc_backend;

-- Auth is platform-wide; payment tables use transaction-local scope policies.
DROP POLICY IF EXISTS backend_auth ON public."user";
CREATE POLICY backend_auth ON public."user" TO btc_backend USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS backend_auth ON public.session;
CREATE POLICY backend_auth ON public.session TO btc_backend USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS backend_auth ON public.account;
CREATE POLICY backend_auth ON public.account TO btc_backend USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS backend_auth ON public.verification;
CREATE POLICY backend_auth ON public.verification TO btc_backend USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS backend_auth ON public.rate_limit;
CREATE POLICY backend_auth ON public.rate_limit TO btc_backend USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS backend_auth ON public.otp_throttle;
CREATE POLICY backend_auth ON public.otp_throttle TO btc_backend USING (true) WITH CHECK (true);
-- Supabase grants its Data API roles every public table by default; only the backend may connect.
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') AND EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
  END IF;
END $$;
COMMIT;
