ALTER TABLE trips ADD COLUMN IF NOT EXISTS public_slug uuid DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS trips_public_slug_idx ON trips (public_slug);
