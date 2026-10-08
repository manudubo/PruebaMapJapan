-- Self-registration, backend half: verified e-mail + OTP purposes.
--
-- 1. users.email_verified_at: set when the user proves they own the address
--    (6-digit code at sign-up, or account recovery). The API treats an
--    account as verified when this is non-NULL OR the Keycloak token says
--    email_verified === true.
--    BACKFILL: every user that exists when this migration runs is stamped
--    with now(). They signed up before verification existed (Keycloak was
--    the only registrar and the invited/test accounts are trusted), and
--    REQUIRE_VERIFIED_EMAIL would otherwise lock them all out of the app on
--    the first deploy. Only the first run stamps (guarded by the column
--    check, so a database already built with `drizzle-kit push` from the new
--    schema keeps its NULLs). Users created afterwards start NULL.
-- 2. email_otp_codes.purpose: 'login' (existing OTP step-up), 'email_verify'
--    (sign-up) or 'recovery' (password reset). A code is only ever valid for
--    the purpose it was issued for, and "a code is pending" / the hourly cap
--    are counted per (user, purpose) so one flow cannot starve another.
--    Existing rows are 'login'.
-- 3. otp_issue(..., p_purpose): the 0009 function with the purpose filter.
--    The 5-argument form is kept as a wrapper for 'login', so a Worker from
--    before this migration keeps working during a rolling deploy.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = 'users' AND column_name = 'email_verified_at'
  ) THEN
    ALTER TABLE users ADD COLUMN email_verified_at timestamptz;
    UPDATE users SET email_verified_at = now();
  END IF;
END
$$;--> statement-breakpoint
ALTER TABLE email_otp_codes ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'login';--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'email_otp_codes_purpose_check' AND conrelid = to_regclass('email_otp_codes')) THEN
    ALTER TABLE email_otp_codes
      ADD CONSTRAINT email_otp_codes_purpose_check CHECK (purpose IN ('login', 'email_verify', 'recovery'));
  END IF;
END
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION otp_issue(
  p_user_id integer,
  p_code_hash text,
  p_ttl_seconds integer,
  p_max_per_window integer,
  p_window_seconds integer,
  p_purpose text
) RETURNS TABLE (status text, otp_id integer, retry_after integer)
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  v_now timestamptz;
  v_window interval := make_interval(secs => p_window_seconds);
  v_pending_expires timestamptz;
  v_count integer;
  v_oldest timestamptz;
  v_id integer;
BEGIN
  -- One lock per user across purposes: issuance is serialized, never deadlocks.
  PERFORM pg_advisory_xact_lock(7001, p_user_id);
  v_now := clock_timestamp();

  SELECT c.expires_at INTO v_pending_expires
    FROM email_otp_codes c
   WHERE c.user_id = p_user_id AND c.purpose = p_purpose
     AND c.used_at IS NULL AND c.expires_at > v_now
   ORDER BY c.created_at DESC
   LIMIT 1;
  IF FOUND THEN
    RETURN QUERY SELECT 'otp_pending'::text, NULL::integer,
      greatest(1, ceil(extract(epoch FROM v_pending_expires - v_now)))::integer;
    RETURN;
  END IF;

  SELECT count(*), min(c.created_at) INTO v_count, v_oldest
    FROM email_otp_codes c
   WHERE c.user_id = p_user_id AND c.purpose = p_purpose AND c.created_at > v_now - v_window;
  IF v_count >= p_max_per_window THEN
    RETURN QUERY SELECT 'otp_rate_limited'::text, NULL::integer,
      greatest(1, ceil(extract(epoch FROM v_oldest + v_window - v_now)))::integer;
    RETURN;
  END IF;

  INSERT INTO email_otp_codes (user_id, code_hash, purpose, created_at, expires_at)
  VALUES (p_user_id, p_code_hash, p_purpose, v_now, v_now + make_interval(secs => p_ttl_seconds))
  RETURNING id INTO v_id;
  RETURN QUERY SELECT 'issued'::text, v_id, NULL::integer;
END
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION otp_issue(
  p_user_id integer,
  p_code_hash text,
  p_ttl_seconds integer,
  p_max_per_window integer,
  p_window_seconds integer
) RETURNS TABLE (status text, otp_id integer, retry_after integer)
LANGUAGE sql VOLATILE AS $$
  SELECT * FROM otp_issue(p_user_id, p_code_hash, p_ttl_seconds, p_max_per_window, p_window_seconds, 'login'::text);
$$;
