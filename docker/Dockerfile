# Avroleva - single image: API + built office SPA (ARCHITECTURE section 7).
# UNTESTED SKETCH in step 1 (deploy is a later step). Chromium/fonts for PDF come with the PDF step.
FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/i18n/package.json packages/i18n/
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/
COPY apps/office/package.json apps/office/
RUN npm ci
COPY . .
ARG VITE_BASE=/avroleva/
RUN npm run build:packages \
 && (cd apps/api && npx prisma generate && npx tsc -p tsconfig.json) \
 && (cd apps/office && VITE_BASE=$VITE_BASE npx vite build)

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/api/package.json apps/api/
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/prisma apps/api/prisma
COPY --from=build /app/apps/api/src/generated apps/api/src/generated
COPY --from=build /app/apps/office/dist apps/office/dist
WORKDIR /app/apps/api
USER node
EXPOSE 3005
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
