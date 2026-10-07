# syntax=docker/dockerfile:1.7
# Keycloak for self-hosting, production mode (`start --optimized`).
# Build context: the repository root (to copy keycloak/themes).
#   docker build -f deploy/selfhost/keycloak/Dockerfile .
#
# Build-time options are baked in here; runtime ones (hostname, DB URL,
# credentials, proxy headers) come from docker-compose.prod.yml.
ARG KC_IMAGE=quay.io/keycloak/keycloak:26.6.1

FROM ${KC_IMAGE} AS builder
# Served under /auth in every hosting mode, so one image fits both
# single-host (https://host/auth) and subdomains (https://auth.domain/auth).
ENV KC_DB=postgres \
    KC_HTTP_RELATIVE_PATH=/auth \
    KC_HEALTH_ENABLED=true \
    KC_METRICS_ENABLED=false
# The custom login/account/email theme (the old keycloak/Dockerfile never
# shipped it, so production showed the stock theme).
COPY --chown=keycloak:keycloak keycloak/themes/ /opt/keycloak/themes/
RUN /opt/keycloak/bin/kc.sh build

FROM ${KC_IMAGE}
COPY --from=builder /opt/keycloak/ /opt/keycloak/
ENTRYPOINT ["/opt/keycloak/bin/kc.sh"]
CMD ["start", "--optimized"]
