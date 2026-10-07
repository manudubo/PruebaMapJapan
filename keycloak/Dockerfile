FROM quay.io/keycloak/keycloak:26.6.1 AS builder
ENV KC_DB=postgres
# The japan-trip login theme carries the SEC-11 sanitising and the generic
# credential-failure messages (no lockout oracle); without it the realm's
# login_theme falls back to the stock theme in production.
COPY themes/ /opt/keycloak/themes/
RUN /opt/keycloak/bin/kc.sh build

FROM quay.io/keycloak/keycloak:26.6.1
COPY --from=builder /opt/keycloak/ /opt/keycloak/
ENTRYPOINT ["/opt/keycloak/bin/kc.sh"]
