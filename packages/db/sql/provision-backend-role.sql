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
ALTER ROLE btc_backend NOSUPERUSER NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO btc_backend;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."user", public.session, public.account, public.verification TO btc_backend;
GRANT SELECT, INSERT, UPDATE ON public.merchant, public.payment_order, public.settlement TO btc_backend;

GRANT SELECT, INSERT ON public.admin_audit, public.settlement_item TO btc_backend;

-- Auth is platform-wide; payment tables use transaction-local scope policies.
DROP POLICY IF EXISTS backend_auth ON public."user";
CREATE POLICY backend_auth ON public."user" TO btc_backend USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS backend_auth ON public.session;
CREATE POLICY backend_auth ON public.session TO btc_backend USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS backend_auth ON public.account;
CREATE POLICY backend_auth ON public.account TO btc_backend USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS backend_auth ON public.verification;
CREATE POLICY backend_auth ON public.verification TO btc_backend USING (true) WITH CHECK (true);
COMMIT;
