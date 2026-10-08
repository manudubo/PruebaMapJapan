# syntax=docker/dockerfile:1.7
# TravelMap backend for self-hosting. Build context: the repository root.
#   docker build -f deploy/selfhost/backend/Dockerfile .
#
# Targets:
#   runtime (default) - node + one bundled file (dist/server.mjs), non-root
#   tools             - full backend workspace with dev dependencies, used by
#                       deploy.sh for `db:preflight` and `db:migrate`
#
# Images come from public.ecr.aws (official Docker library mirror) so pulls are
# not subject to Docker Hub's anonymous rate limit.
ARG NODE_IMAGE=public.ecr.aws/docker/library/node:22-alpine

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
# npm ci in a workspace repo needs the root manifest/lockfile and every
# workspace's package.json; only the backend's dependencies are installed.
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
# Optional extra CA (build-time only, e.g. behind a TLS-intercepting proxy):
#   docker build --secret id=extra_ca,src=/path/ca.crt ...
RUN --mount=type=cache,target=/root/.npm \
    --mount=type=secret,id=extra_ca,required=false \
    if [ -f /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; \
    npm ci --workspace=backend --include-workspace-root=false --no-audit --no-fund

FROM deps AS source
COPY backend/ backend/
# Repo-level shared settings (config/*.json) when the repo has them; bound
# instead of COPY'd so a checkout without the folder still builds.
RUN --mount=type=bind,target=/ctx \
    if [ -d /ctx/config ]; then cp -r /ctx/config /app/config; fi

FROM source AS tools
WORKDIR /app/backend
USER node
CMD ["npm", "run", "db:migrate"]

FROM source AS build
RUN npm run build:node --workspace=backend

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    PORT=8787 \
    HOST=0.0.0.0
WORKDIR /app
COPY --from=build --chown=root:root /app/backend/dist/server.mjs /app/server.mjs
USER node
EXPOSE 8787
# Liveness only (no DB): readiness is /api/health/ready, checked by deploy.sh.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "--enable-source-maps", "/app/server.mjs"]
