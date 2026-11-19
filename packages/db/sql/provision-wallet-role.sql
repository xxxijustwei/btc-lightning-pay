-- Run as the database owner after provision-backend-role.sql, then set btc_wallet's password.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'btc_wallet') THEN
    CREATE ROLE btc_wallet LOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
  IF EXISTS (
    SELECT FROM pg_roles WHERE rolname = 'btc_wallet'
    AND (NOT rolcanlogin OR rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication)
  ) THEN
    RAISE EXCEPTION 'btc_wallet must be an unprivileged login role';
  END IF;
  -- The SDK uses unqualified table names for both migrations and runtime queries.
  EXECUTE format('ALTER ROLE btc_wallet IN DATABASE %I SET search_path = breez_wallet', current_database());
END $$;

CREATE SCHEMA IF NOT EXISTS breez_wallet;
REVOKE ALL ON SCHEMA breez_wallet FROM PUBLIC, btc_backend;
GRANT USAGE, CREATE ON SCHEMA breez_wallet TO btc_wallet;

COMMIT;
