-- SEC-07 follow-up: atomic OTP issuance.
--
-- otp-request used to run "pending code?", "hourly cap reached?" and the
-- INSERT as three separate statements, so a burst of parallel requests for
-- one user all passed both checks: 20 requests issued (and emailed) 20
-- codes, bypassing otp_pending and the BUG-16 5-per-hour cap.
--
-- otp_issue() does all three inside ONE statement (one implicit transaction,
-- which also works over the Neon HTTP driver that has no interactive
-- transactions):
--   1. pg_advisory_xact_lock(7001, user_id) — serializes issuance per user
--      (other users never wait); released at commit.
--   2. Only after the lock, clock_timestamp() and the pending / cap queries:
--      in READ COMMITTED each query of a VOLATILE plpgsql function takes a
--      fresh snapshot, so it sees the code a previous lock holder committed.
--   3. INSERT with created_at/expires_at from that same clock.
-- Semantics are unchanged: pending is checked first; the cap counts every
-- code (used, burned, expired) created in the last window; retry_after is
-- the seconds until the pending code expires / the oldest code in the window
-- ages out (at least 1).
CREATE OR REPLACE FUNCTION otp_issue(
  p_user_id integer,
  p_code_hash text,
  p_ttl_seconds integer,
  p_max_per_window integer,
  p_window_seconds integer
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
  PERFORM pg_advisory_xact_lock(7001, p_user_id);
  v_now := clock_timestamp();

  SELECT c.expires_at INTO v_pending_expires
    FROM email_otp_codes c
   WHERE c.user_id = p_user_id AND c.used_at IS NULL AND c.expires_at > v_now
   ORDER BY c.created_at DESC
   LIMIT 1;
  IF FOUND THEN
    RETURN QUERY SELECT 'otp_pending'::text, NULL::integer,
      greatest(1, ceil(extract(epoch FROM v_pending_expires - v_now)))::integer;
    RETURN;
  END IF;

  SELECT count(*), min(c.created_at) INTO v_count, v_oldest
    FROM email_otp_codes c
   WHERE c.user_id = p_user_id AND c.created_at > v_now - v_window;
  IF v_count >= p_max_per_window THEN
    RETURN QUERY SELECT 'otp_rate_limited'::text, NULL::integer,
      greatest(1, ceil(extract(epoch FROM v_oldest + v_window - v_now)))::integer;
    RETURN;
  END IF;

  INSERT INTO email_otp_codes (user_id, code_hash, created_at, expires_at)
  VALUES (p_user_id, p_code_hash, v_now, v_now + make_interval(secs => p_ttl_seconds))
  RETURNING id INTO v_id;
  RETURN QUERY SELECT 'issued'::text, v_id, NULL::integer;
END
$$;
