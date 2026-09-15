# Avroleva Elevators - one image: API (Express 5 + Prisma + pg-boss worker, ROLE=all) + built office SPA (/)
# + built technician PWA (/tech/). ARCHITECTURE section 7; nginx path-prefix rules in VPS-GUIDE.md.
#
#   docker build -f docker/Dockerfile --build-arg VITE_BASE=/avroleva/ -t avroleva .
#
# Stages
#   deps       full `npm ci` (all workspaces), cached on the package.json + lock layer
#   build      packages -> prisma client -> api (tsc) -> seed (tsc, separate outDir) -> office/tech (vite)
#   prod-deps  `npm ci --omit=dev` + the prisma CLI (needed at start for `migrate deploy`)
#   runtime    node:22-bookworm-slim, user node, only dist/ + prod node_modules + static data files
#
# The seed (apps/api/prisma/seed.ts) is compiled with tsc (apps/api/tsconfig.seed.json) instead of
# shipping tsx: no dev tooling in the runtime image, and the seed runs as plain node like the app.

ARG NODE_IMAGE=node:22-bookworm-slim

# ---------------------------------------------------------------------------------------- deps
FROM ${NODE_IMAGE} AS deps
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# Every workspace package.json first: npm ci needs them to resolve the lock, and this layer is
# only invalidated when a dependency changes.
COPY package.json package-lock.json ./
COPY packages/i18n/package.json packages/i18n/
COPY packages/contracts/package.json packages/contracts/
COPY packages/domain-data/package.json packages/domain-data/
COPY apps/api/package.json apps/api/
COPY apps/office/package.json apps/office/
COPY apps/tech/package.json apps/tech/
RUN npm ci --no-audit --no-fund

# --------------------------------------------------------------------------------------- build
FROM deps AS build
# Path prefix baked into both SPAs (must equal BASE_PATH + "/"). Tech app lives under <base>tech/.
ARG VITE_BASE=/avroleva/
ENV VITE_BASE=${VITE_BASE}
ENV VITE_TECH_BASE=${VITE_BASE}tech/
# Empty = same origin (the API serves the PWA itself).
ENV VITE_API_BASE=
COPY . .
RUN npm run build:packages \
 && npm run build -w apps/api \
 && npm exec -w apps/api -- tsc -p tsconfig.seed.json \
 && npm exec -w apps/office -- vite build \
 && npm exec -w apps/tech -- vite build

# ----------------------------------------------------------------------------------- prod-deps
FROM ${NODE_IMAGE} AS prod-deps
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/i18n/package.json packages/i18n/
COPY packages/contracts/package.json packages/contracts/
COPY packages/domain-data/package.json packages/domain-data/
COPY apps/api/package.json apps/api/
COPY apps/office/package.json apps/office/
COPY apps/tech/package.json apps/tech/
# Production tree, plus the prisma CLI (a devDependency) pinned to the lock's version so the
# container can run `prisma migrate deploy` at start. --no-save keeps package.json/lock untouched.
# The final rm drops what the glibc/x64 runtime never loads: typescript (optional peer of the
# prisma CLI, only used to read a prisma.config.ts - not shipped) and sharp's musl/wasm fallbacks.
RUN npm ci --omit=dev --no-audit --no-fund \
 && PRISMA_VERSION="$(node -p "require('./package-lock.json').packages['node_modules/prisma'].version")" \
 && npm install --no-save --omit=dev --no-audit --no-fund "prisma@${PRISMA_VERSION}" \
 && npm cache clean --force \
 && rm -rf node_modules/typescript node_modules/@img/*musl* node_modules/@img/sharp-wasm32

# ------------------------------------------------------------------------------------- runtime
FROM ${NODE_IMAGE} AS runtime
# openssl: Prisma engines. fontconfig + DejaVu: libvips (sharp) text rendering (demo seed photos)
# without the "Fontconfig error: Cannot load default config file" warning.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates fontconfig fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    PORT=3005 \
    DATA_DIR=/data
WORKDIR /app
# package.json files + production node_modules (workspace symlinks point at ../../packages/*).
COPY --from=prod-deps --chown=node:node /app ./
# Shared packages: compiled output + the JSON/data files domain-data reads next to its dist.
COPY --from=build --chown=node:node /app/packages/i18n/dist packages/i18n/dist
COPY --from=build --chown=node:node /app/packages/contracts/dist packages/contracts/dist
# Copy the whole package (dist + every JSON data folder) so a new data folder can never be
# forgotten again: 2026-09-15 the release image lacked billing/ and jobs/ and crash-looped.
COPY --from=build --chown=node:node /app/packages/domain-data/ packages/domain-data/
# API: compiled app, compiled seed, generated Prisma client (imported as dist/../generated), schema
# + migrations for `prisma migrate deploy`.
COPY --from=build --chown=node:node /app/apps/api/dist apps/api/dist
COPY --from=build --chown=node:node /app/apps/api/dist-seed apps/api/dist-seed
COPY --from=build --chown=node:node /app/apps/api/src/generated/prisma apps/api/dist/generated/prisma
COPY --from=build --chown=node:node /app/apps/api/prisma/schema.prisma apps/api/prisma/schema.prisma
COPY --from=build --chown=node:node /app/apps/api/prisma/migrations apps/api/prisma/migrations
# Built SPAs (served by the API at / and /tech/).
COPY --from=build --chown=node:node /app/apps/office/dist apps/office/dist
COPY --from=build --chown=node:node /app/apps/tech/dist apps/tech/dist
COPY --chown=node:node docker/entrypoint.sh docker/entrypoint.sh
# The compiled seed imports ../src/generated/prisma - one physical copy of the client, linked.
RUN ln -s ../../dist/generated apps/api/dist-seed/src/generated \
 && chmod +x docker/entrypoint.sh \
 && mkdir -p /data && chown node:node /data
USER node
WORKDIR /app/apps/api
EXPOSE 3005
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3005/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/app/docker/entrypoint.sh"]
