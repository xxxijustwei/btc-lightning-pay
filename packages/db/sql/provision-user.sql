-- Run after schema initialization in Supabase SQL Editor. Change both values below.
-- Re-running for an existing email preserves its ID, verification state, and sessions.
INSERT INTO public."user" (id, name, email, email_verified)
VALUES (gen_random_uuid()::text, 'Example User', lower(trim('user@example.com')), false)
ON CONFLICT (email) DO NOTHING
RETURNING id, email, email_verified;
