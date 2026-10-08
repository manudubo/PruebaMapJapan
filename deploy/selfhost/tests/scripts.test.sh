#!/usr/bin/env bash
# Unit tests for deploy/selfhost/scripts (no Docker daemon, no network):
# .env parsing, HOST_MODE/INGRESS derivation, gen-secrets.sh, funnel.sh
# against a stub `tailscale`, and `docker compose config` for every mode when
# the docker CLI is available.
#
#   bash deploy/selfhost/tests/scripts.test.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPTS="$HERE/../scripts"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
export NO_COLOR=1
export SELFHOST_ENV_FILE="$WORK/.env"
pass=0; failn=0
t_ok() { printf 'ok   %s\n' "$1"; pass=$((pass + 1)); }
t_fail() { printf 'FAIL %s\n' "$1"; [ -n "${2:-}" ] && printf '     %s\n' "$2"; failn=$((failn + 1)); }
expect_eq() { if [ "$2" = "$3" ]; then t_ok "$1"; else t_fail "$1" "expected '$2', got '$3'"; fi; }
expect_has() { case "$3" in *"$2"*) t_ok "$1" ;; *) t_fail "$1" "missing '$2' in: $3" ;; esac; }

base_env() {
  cat > "$WORK/.env" <<'EOF'
HOST_MODE=single-host
PUBLIC_HOST=legion-server.tailad4a36.ts.net
EMAIL_FROM=TravelMap <login@example.com>
QUOTED="double quoted"
SINGLE='single $quoted'
# comment
  # indented comment
POSTGRES_SUPERUSER_PASSWORD=CHANGE_ME_SECRET
APP_DB_PASSWORD=
KC_DB_PASSWORD=already-set
KC_ADMIN_PASSWORD=CHANGE_ME_SECRET
OTP_SECRET=CHANGE_ME_SECRET
EOF
  chmod 600 "$WORK/.env"
}

# Run derive_config in a subshell with extra KEY=VALUE overrides; print vars.
derive() {
  (
    for kv in "$@"; do export "${kv?}"; done
    # shellcheck source=SCRIPTDIR/../scripts/lib/common.sh
    . "$SCRIPTS/lib/common.sh"
    load_config >/dev/null
    printf '%s|%s|%s|%s|%s|%s|%s\n' "$KC_PUBLIC_URL" "$API_PUBLIC_URL" "$COMPOSE_PROFILES" \
      "$CADDY_CONFIG" "$TRUSTED_PROXY_HOPS" "$PASSKEY_RP_ID" "$ALLOWED_ORIGINS"
  ) 2>&1
}

# --- .env parsing -------------------------------------------------------------
base_env
out="$(
  # shellcheck source=SCRIPTDIR/../scripts/lib/common.sh
  . "$SCRIPTS/lib/common.sh"
  load_env_file "$WORK/.env"
  printf '%s|%s|%s' "$EMAIL_FROM" "$QUOTED" "$SINGLE"
)"
# shellcheck disable=SC2016  # the literal $quoted is the point
expect_eq "load_env_file keeps spaces/<> and strips quotes, never evaluates" \
  'TravelMap <login@example.com>|double quoted|single $quoted' "$out"
out="$(EMAIL_FROM=override bash -c '. "$1/lib/common.sh"; load_env_file "$2"; printf %s "$EMAIL_FROM"' _ "$SCRIPTS" "$WORK/.env")"
expect_eq "environment wins over .env (like docker compose)" override "$out"

# --- mode derivation ------------------------------------------------------------
expect_eq "single-host defaults" \
  "https://legion-server.tailad4a36.ts.net/auth|https://legion-server.tailad4a36.ts.net/api|local-proxy|single-host|2|legion-server.tailad4a36.ts.net|https://manudubo.github.io" \
  "$(derive)"
expect_eq "single-host strips a trailing dot from the tailscale name" \
  "https://legion-server.tailad4a36.ts.net/auth" "$(derive PUBLIC_HOST=legion-server.tailad4a36.ts.net. | cut -d'|' -f1)"
expect_has "single-host without PUBLIC_HOST fails" "needs PUBLIC_HOST" "$(derive PUBLIC_HOST=)"
expect_has "single-host rejects a URL as PUBLIC_HOST" "not a host name" "$(derive PUBLIC_HOST=https://x.ts.net)"
expect_has "single-host rejects INGRESS=caddy" "funnel only" "$(derive INGRESS=caddy)"
expect_eq "subdomains + cloudflared" \
  "https://auth.example.com/auth|https://api.example.com/api|local-proxy,cloudflared|subdomains-tunnel|2|auth.example.com|https://manudubo.github.io" \
  "$(derive HOST_MODE=subdomains DOMAIN=example.com CLOUDFLARE_TUNNEL_TOKEN=t)"
expect_has "cloudflared without token fails" "CLOUDFLARE_TUNNEL_TOKEN" "$(derive HOST_MODE=subdomains DOMAIN=example.com)"
expect_eq "subdomains + caddy" \
  "https://auth.example.com/auth|https://api.example.com/api|public-proxy|subdomains-https|1|auth.example.com|https://manudubo.github.io" \
  "$(derive HOST_MODE=subdomains DOMAIN=example.com INGRESS=caddy ACME_EMAIL=a@b.c)"
expect_has "caddy without ACME_EMAIL fails" "ACME_EMAIL" "$(derive HOST_MODE=subdomains DOMAIN=example.com INGRESS=caddy)"
expect_has "unknown HOST_MODE fails" "HOST_MODE must be" "$(derive HOST_MODE=both)"
expect_eq "TRUSTED_PROXY_HOPS can be overridden" 3 "$(derive TRUSTED_PROXY_HOPS=3 | cut -d'|' -f5)"

# --- gen-secrets.sh ---------------------------------------------------------------
base_env
out="$(SELFHOST_ENV_FILE="$WORK/.env" "$SCRIPTS/gen-secrets.sh" --dry-run)"
expect_has "dry-run lists placeholders and empty values" "POSTGRES_SUPERUSER_PASSWORD APP_DB_PASSWORD KC_ADMIN_PASSWORD OTP_SECRET" "$out"
expect_eq "dry-run changes nothing" 3 "$(grep -c CHANGE_ME_SECRET "$WORK/.env")"
out="$(SELFHOST_ENV_FILE="$WORK/.env" "$SCRIPTS/gen-secrets.sh")"
expect_eq "no placeholder left" 0 "$(grep -c CHANGE_ME "$WORK/.env")"
expect_eq "existing secret untouched" "KC_DB_PASSWORD=already-set" "$(grep '^KC_DB_PASSWORD=' "$WORK/.env")"
expect_eq "generated secrets are 64 hex chars" 4 "$(grep -cE '^(POSTGRES_SUPERUSER_PASSWORD|APP_DB_PASSWORD|KC_ADMIN_PASSWORD|OTP_SECRET)=[0-9a-f]{64}$' "$WORK/.env")"
expect_eq ".env stays mode 600" 600 "$(stat -c %a "$WORK/.env")"
case "$out" in *[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]*) t_fail "secret values never printed" "$out" ;; *) t_ok "secret values never printed" ;; esac
expect_eq "EMAIL_FROM line preserved" "EMAIL_FROM=TravelMap <login@example.com>" "$(grep '^EMAIL_FROM=' "$WORK/.env")"
before="$(cat "$WORK/.env")"
SELFHOST_ENV_FILE="$WORK/.env" "$SCRIPTS/gen-secrets.sh" >/dev/null
expect_eq "second run is a no-op" "$before" "$(cat "$WORK/.env")"
old="$(grep '^OTP_SECRET=' "$WORK/.env")"
SELFHOST_ENV_FILE="$WORK/.env" "$SCRIPTS/gen-secrets.sh" --rotate OTP_SECRET >/dev/null
new="$(grep '^OTP_SECRET=' "$WORK/.env")"
[ "$old" != "$new" ] && t_ok "--rotate replaces one secret" || t_fail "--rotate replaces one secret"
expect_eq "--rotate leaves the others" "KC_DB_PASSWORD=already-set" "$(grep '^KC_DB_PASSWORD=' "$WORK/.env")"
expect_has "--rotate rejects unknown names" "not one of" "$(SELFHOST_ENV_FILE="$WORK/.env" "$SCRIPTS/gen-secrets.sh" --rotate PATH 2>&1)"

# --- funnel.sh with a stub tailscale ----------------------------------------------------
mkdir -p "$WORK/bin"
cat > "$WORK/bin/tailscale" <<'EOF'
#!/usr/bin/env bash
echo "tailscale $*" >> "$TS_LOG"
case "$1 $2" in
  "status --json") printf '{"Self":{"DNSName":"%s."}}' "${TS_NAME:-legion-server.tailad4a36.ts.net}" ;;
  "serve status") cat "$TS_SERVE_JSON" ;;
  "funnel status") echo "(stub funnel status)" ;;
  "funnel --bg") exit 0 ;;
  "funnel --https=443") exit 0 ;;
  *) echo "unexpected: $*" >&2; exit 3 ;;
esac
EOF
chmod +x "$WORK/bin/tailscale"
cat > "$WORK/bin/curl" <<'EOF'
#!/usr/bin/env bash
printf 200
EOF
chmod +x "$WORK/bin/curl"
export TS_LOG="$WORK/ts.log" TS_SERVE_JSON="$WORK/serve.json"
H=legion-server.tailad4a36.ts.net
funnel() { PATH="$WORK/bin:$PATH" SELFHOST_ENV_FILE="$WORK/.env" "$SCRIPTS/funnel.sh" "$@" 2>&1; }
existing='"TCP":{"8443":{"HTTPS":true},"8081":{"HTTPS":true}},"Web":{"'$H':8443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:8123"}}},"'$H':8081":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:3001"}}}},"AllowFunnel":{"'$H':8443":true}'

printf '{%s}' "$existing" > "$TS_SERVE_JSON"; : > "$TS_LOG"
out="$(funnel enable)"
expect_has "enable on a free 443 runs funnel --bg --https=443 to the proxy" "tailscale funnel --bg --https=443 http://127.0.0.1:28080" "$(cat "$TS_LOG")"
expect_has "enable prints status before and after" "(stub funnel status)" "$out"
grep -q reset "$TS_LOG" && t_fail "never runs reset" || t_ok "never runs reset"

printf '{"TCP":{"443":{"HTTPS":true}},"Web":{"%s:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:28080"}}}}}' "$H" > "$TS_SERVE_JSON"; : > "$TS_LOG"
out="$(funnel enable)"
expect_has "enable when already ours is a no-op" "Already enabled" "$out"
grep -q -- '--bg' "$TS_LOG" && t_fail "no second funnel command" || t_ok "no second funnel command"

printf '{"TCP":{"443":{"HTTPS":true}},"Web":{"%s:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:9999"}}}}}' "$H" > "$TS_SERVE_JSON"; : > "$TS_LOG"
out="$(funnel enable)"; rc=$?
expect_eq "enable refuses when 443 serves something else (exit 1)" 1 "$rc"
expect_has "refusal explains it" "Not overwriting" "$out"
grep -qE -- '--bg|off|reset' "$TS_LOG" && t_fail "nothing changed on refusal" "$(cat "$TS_LOG")" || t_ok "nothing changed on refusal"

out="$(funnel disable)"; rc=$?
expect_eq "disable refuses to touch a foreign 443" 1 "$rc"

printf '{"TCP":{"443":{"HTTPS":true}},"Web":{"%s:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:28080"}}}}}' "$H" > "$TS_SERVE_JSON"; : > "$TS_LOG"
funnel disable >/dev/null
expect_has "disable turns off only 443" "tailscale funnel --https=443 off" "$(cat "$TS_LOG")"

: > "$TS_LOG"
out="$(TS_NAME=other-box.tail1.ts.net funnel enable)"; rc=$?
expect_eq "enable refuses when PUBLIC_HOST is not this machine" 1 "$rc"
expect_has "and says why" "PUBLIC_HOST in .env" "$out"

printf '{}' > "$TS_SERVE_JSON"; : > "$TS_LOG"
funnel enable --dry-run >/dev/null
grep -q -- '--bg' "$TS_LOG" && t_fail "--dry-run runs nothing" || t_ok "--dry-run runs nothing"

# --- keycloak-apply.sh / add-user.sh refuse bad input before contacting Keycloak ------------
base_env
"$SCRIPTS/gen-secrets.sh" >/dev/null 2>&1
out="$(SMTP_HOST=smtp.gmail.com SMTP_USER=u@gmail.com SMTP_PASS=x SMTP_SECURE=none \
  "$SCRIPTS/keycloak-apply.sh" --dry-run 2>&1)"; rc=$?
expect_eq "keycloak-apply.sh: plain SMTP refused (production realm needs TLS)" 1 "$rc"
expect_has "  and says why" "starttls or tls" "$out"
out="$(SMTP_HOST=smtp.gmail.com SMTP_USER=u@gmail.com SMTP_PASS=x SMTP_PORT=abc \
  "$SCRIPTS/keycloak-apply.sh" --dry-run 2>&1)"; rc=$?
expect_eq "keycloak-apply.sh: non-numeric SMTP_PORT refused" 1 "$rc"
out="$(SMTP_HOST=smtp.gmail.com SMTP_USER=u@gmail.com SMTP_PASS=x EMAIL_FROM=u@gmail.com REGISTRATION_ENABLED=yes \
  "$SCRIPTS/keycloak-apply.sh" --dry-run 2>&1)"; rc=$?
expect_eq "keycloak-apply.sh: REGISTRATION_ENABLED must be true/false" 1 "$rc"
expect_has "  and says why" "REGISTRATION_ENABLED must be true or false" "$out"
out="$(SMTP_HOST=smtp.gmail.com SMTP_USER=u@gmail.com SMTP_PASS=x EMAIL_FROM=u@gmail.com RECAPTCHA_SITE_KEY=abc \
  "$SCRIPTS/keycloak-apply.sh" --dry-run 2>&1)"; rc=$?
expect_eq "keycloak-apply.sh: half a reCAPTCHA key pair refused" 1 "$rc"
expect_has "  and says why" "RECAPTCHA_SITE_KEY and RECAPTCHA_SECRET_KEY" "$out"
for bad_origin in https://localhost:5173 http://localhost:5173 https://127.0.0.1 http://manudubo.github.io; do
  out="$(SMTP_HOST=smtp.gmail.com SMTP_USER=u@gmail.com SMTP_PASS=x EMAIL_FROM=u@gmail.com FRONTEND_ORIGIN=$bad_origin \
    "$SCRIPTS/keycloak-apply.sh" --dry-run 2>&1)"; rc=$?
  expect_eq "keycloak-apply.sh: FRONTEND_ORIGIN=$bad_origin refused" 1 "$rc"
  expect_has "  and says why" "Back to application" "$out"
done
grep -q 'printf .  "registration_allowed": %s' "$SCRIPTS/keycloak-apply.sh" \
  && grep -q -- '-e TF_VAR_recaptcha_secret_key' "$SCRIPTS/keycloak-apply.sh" \
  && ! grep -q 'recaptcha_secret_key"' "$SCRIPTS/keycloak-apply.sh" \
  && t_ok "keycloak-apply.sh: sign-up flag in the tfvars file, captcha secret only in the environment" \
  || t_fail "keycloak-apply.sh: sign-up flag in the tfvars file, captcha secret only in the environment"
for bad in 'not-an-email' 'a b@example.com' 'x@y' '"><@example.com'; do
  out="$("$SCRIPTS/add-user.sh" "$bad" 2>&1)"; rc=$?
  expect_eq "add-user.sh refuses '$bad'" 1 "$rc"
done
expect_has "  and says why" "must be an email address" "$out"
if [ -d "$HERE/../terraform" ]; then
  t_fail "deploy/selfhost/terraform override files are gone (the production profile replaces them)"
else
  t_ok "no Terraform override files: keycloak-apply.sh uses profile=production"
fi
grep -q '"profile": "production"' "$SCRIPTS/keycloak-apply.sh" \
  && t_ok "keycloak-apply.sh applies profile=production" || t_fail "keycloak-apply.sh applies profile=production"

# --- docker compose config for every mode --------------------------------------------------
if docker compose version >/dev/null 2>&1; then
  check_compose() { # <label> <expected services> KEY=VAL...
    local label="$1" want="$2"; shift 2
    local got
    got="$(
      for kv in "$@"; do export "${kv?}"; done
      # shellcheck source=SCRIPTDIR/../scripts/lib/common.sh
      . "$SCRIPTS/lib/common.sh"
      load_config >/dev/null
      compose config --services 2>&1 | sort | tr '\n' ' '
    )"
    expect_eq "compose services: $label" "$want" "$got"
  }
  check_compose single-host "backend keycloak postgres proxy "
  check_compose "subdomains+cloudflared" "backend cloudflared keycloak postgres proxy " \
    HOST_MODE=subdomains DOMAIN=example.com CLOUDFLARE_TUNNEL_TOKEN=t
  check_compose "subdomains+caddy" "backend keycloak postgres proxy-public " \
    HOST_MODE=subdomains DOMAIN=example.com INGRESS=caddy ACME_EMAIL=a@b.c
  published="$(
    # shellcheck source=SCRIPTDIR/../scripts/lib/common.sh
    . "$SCRIPTS/lib/common.sh"; load_config >/dev/null
    compose config --format json | python3 -c '
import json, sys
c = json.load(sys.stdin)
print(" ".join(sorted("%s:%s" % (p.get("host_ip") or "0.0.0.0", p["published"]) for s in c["services"].values() for p in s.get("ports", []))))'
  )"
  expect_eq "single-host publishes only on 127.0.0.1" "127.0.0.1:28080 127.0.0.1:28081" "$published"
else
  printf 'skip docker compose checks (no docker compose CLI)\n'
fi

# --- Caddyfiles parse (needs a Docker daemon; opt-in: CADDY_VALIDATE=1) -----------------------
if [ "${CADDY_VALIDATE:-0}" = 1 ]; then
  for c in single-host subdomains-tunnel subdomains-https; do
    out="$(docker run --rm -e PUBLIC_HOST=x.ts.net -e DOMAIN=example.com -e ACME_EMAIL=a@example.com \
      -v "$HERE/../caddy:/etc/caddy:ro" "${CADDY_IMAGE:-public.ecr.aws/docker/library/caddy:2.10-alpine}" \
      caddy validate --config "/etc/caddy/$c.Caddyfile" --adapter caddyfile 2>&1)"
    expect_has "Caddyfile $c is valid" "Valid configuration" "$out"
  done
fi

printf '\n%d passed, %d failed\n' "$pass" "$failn"
[ "$failn" -eq 0 ]
