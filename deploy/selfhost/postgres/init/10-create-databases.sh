#!/bin/sh
# Runs once, when the Postgres volume is first created (docker-entrypoint-initdb.d).
# Two databases, two least-privilege owners; the superuser is not used by apps:
#   travelmap (owner travelmap) - backend
#   keycloak  (owner keycloak)  - Keycloak
# Changing APP_DB_PASSWORD / KC_DB_PASSWORD later does NOT re-run this script:
# use deploy/selfhost/scripts/rotate-db-password.sh.
set -eu

: "${APP_DB_PASSWORD:?APP_DB_PASSWORD is not set}"
: "${KC_DB_PASSWORD:?KC_DB_PASSWORD is not set}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v app_pw="$APP_DB_PASSWORD" -v kc_pw="$KC_DB_PASSWORD" <<'SQL'
CREATE ROLE travelmap LOGIN PASSWORD :'app_pw';
CREATE ROLE keycloak LOGIN PASSWORD :'kc_pw';
CREATE DATABASE travelmap OWNER travelmap ENCODING 'UTF8' TEMPLATE template0;
CREATE DATABASE keycloak OWNER keycloak ENCODING 'UTF8' TEMPLATE template0;
REVOKE ALL ON DATABASE travelmap FROM PUBLIC;
REVOKE ALL ON DATABASE keycloak FROM PUBLIC;
\connect travelmap
ALTER SCHEMA public OWNER TO travelmap;
\connect keycloak
ALTER SCHEMA public OWNER TO keycloak;
SQL
