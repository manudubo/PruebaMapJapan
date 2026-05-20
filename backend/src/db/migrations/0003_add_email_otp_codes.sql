CREATE TABLE IF NOT EXISTS "email_otp_codes" (
  "id"         SERIAL PRIMARY KEY,
  "user_id"    INTEGER      NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "code_hash"  TEXT         NOT NULL,
  "expires_at" TIMESTAMPTZ  NOT NULL,
  "used_at"    TIMESTAMPTZ,
  "attempts"   INTEGER      NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
