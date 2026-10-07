-- Reconcile databases built with `drizzle-kit push` (the pre-Phase-24
-- SETUP.md / DEVELOPMENT.md instructions) with the SQL migrations.
--
-- push builds tables from schema.ts, which has no SQL default for
-- trips.public_slug (it is generated in JS) and a nullable
-- users.preferences, and names foreign keys "<table>_<col>_<ref>_id_fk".
-- On such a database:
--   * trips that existed when public_slug was added kept NULL: sharing them
--     sets is_public but there is no public URL;
--   * users can have NULL preferences, which the API returns as null.
-- Every statement is a no-op on a database built by the migrator.
UPDATE "trips" SET "public_slug" = gen_random_uuid() WHERE "public_slug" IS NULL;--> statement-breakpoint
ALTER TABLE "trips" ALTER COLUMN "public_slug" SET DEFAULT gen_random_uuid();--> statement-breakpoint
UPDATE "users" SET "preferences" = '{}'::jsonb WHERE "preferences" IS NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "preferences" SET NOT NULL;--> statement-breakpoint
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('activities', 'activities_day_id_days_id_fk', 'activities_day_id_fkey'),
    ('days', 'days_destination_id_destinations_id_fk', 'days_destination_id_fkey'),
    ('destinations', 'destinations_trip_id_trips_id_fk', 'destinations_trip_id_fkey'),
    ('email_otp_codes', 'email_otp_codes_user_id_users_id_fk', 'email_otp_codes_user_id_fkey'),
    ('hotels', 'hotels_destination_id_destinations_id_fk', 'hotels_destination_id_fkey'),
    ('trips', 'trips_user_id_users_id_fk', 'trips_user_id_fkey')
  ) AS v(tbl, old_name, new_name) LOOP
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = r.old_name AND conrelid = to_regclass(r.tbl))
       AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = r.new_name AND conrelid = to_regclass(r.tbl)) THEN
      EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I', r.tbl, r.old_name, r.new_name);
    END IF;
  END LOOP;
END
$$;
