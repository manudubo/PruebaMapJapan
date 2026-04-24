-- =============================================================================
-- 0000_initial.sql — Full schema for PruebaMapJapan
-- =============================================================================

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "users" (
  "id"           SERIAL PRIMARY KEY,
  "keycloak_id"  VARCHAR(255)  NOT NULL,
  "email"        VARCHAR(255)  NOT NULL,
  "name"         VARCHAR(255)  NOT NULL,
  "avatar_url"   TEXT,
  "preferences"  JSONB         NOT NULL DEFAULT '{}',
  "created_at"   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  "updated_at"   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "users_keycloak_id_idx"
  ON "users" ("keycloak_id");

-- ---------------------------------------------------------------------------
-- trips
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "trips" (
  "id"              SERIAL PRIMARY KEY,
  "user_id"         INTEGER       NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name"            VARCHAR(255)  NOT NULL,
  "description"     TEXT,
  "start_date"      DATE,
  "end_date"        DATE,
  "cover_image_url" TEXT,
  "is_public"       BOOLEAN       NOT NULL DEFAULT FALSE,
  "created_at"      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  "updated_at"      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "trips_user_id_idx"
  ON "trips" ("user_id");

-- ---------------------------------------------------------------------------
-- destinations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "destinations" (
  "id"           SERIAL PRIMARY KEY,
  "trip_id"      INTEGER       NOT NULL REFERENCES "trips"("id") ON DELETE CASCADE,
  "city_name"    VARCHAR(255)  NOT NULL,
  "country"      VARCHAR(100)  NOT NULL,
  "start_date"   DATE,
  "end_date"     DATE,
  "lat"          NUMERIC(10,7),
  "lng"          NUMERIC(10,7),
  "zoom_level"   INTEGER       DEFAULT 12,
  "order_index"  INTEGER       NOT NULL DEFAULT 0,
  "created_at"   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "destinations_trip_id_idx"
  ON "destinations" ("trip_id");

-- ---------------------------------------------------------------------------
-- hotels
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "hotels" (
  "id"             SERIAL PRIMARY KEY,
  "destination_id" INTEGER       NOT NULL REFERENCES "destinations"("id") ON DELETE CASCADE,
  "name"           VARCHAR(255)  NOT NULL,
  "lat"            NUMERIC(10,7),
  "lng"            NUMERIC(10,7),
  "check_in_date"  DATE,
  "check_out_date" DATE
);

-- ---------------------------------------------------------------------------
-- days
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "days" (
  "id"             SERIAL PRIMARY KEY,
  "destination_id" INTEGER       NOT NULL REFERENCES "destinations"("id") ON DELETE CASCADE,
  "date"           DATE          NOT NULL,
  "label"          VARCHAR(255),
  "color_hex"      VARCHAR(7),
  "order_index"    INTEGER       NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS "days_destination_id_idx"
  ON "days" ("destination_id");

-- ---------------------------------------------------------------------------
-- activities
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "activities" (
  "id"          SERIAL PRIMARY KEY,
  "day_id"      INTEGER       NOT NULL REFERENCES "days"("id") ON DELETE CASCADE,
  "name"        VARCHAR(255)  NOT NULL,
  "lat"         NUMERIC(10,7),
  "lng"         NUMERIC(10,7),
  "notes"       TEXT,
  "is_optional" BOOLEAN       NOT NULL DEFAULT FALSE,
  "is_generic"  BOOLEAN       NOT NULL DEFAULT FALSE,
  "maps_url"    TEXT,
  "order_index" INTEGER       NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS "activities_day_id_idx"
  ON "activities" ("day_id");
