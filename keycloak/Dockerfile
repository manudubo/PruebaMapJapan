FROM quay.io/keycloak/keycloak:26.6.1 AS builder
ENV KC_DB=postgres
RUN /opt/keycloak/bin/kc.sh build

FROM quay.io/keycloak/keycloak:26.6.1
COPY --from=builder /opt/keycloak/ /opt/keycloak/
COPY realm-export.json /opt/keycloak/data/import/
ENTRYPOINT ["/opt/keycloak/bin/kc.sh"]
