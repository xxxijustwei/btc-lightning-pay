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
