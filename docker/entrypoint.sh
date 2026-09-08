#!/bin/sh
# Container start: migrate -> bootstrap seed -> API (+ worker, ROLE=all). Any failure stops the
# container (restart: unless-stopped retries; the logs say which step failed).
set -eu
cd /app/apps/api

echo "[entrypoint] prisma migrate deploy"
/app/node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma

# Idempotent: system checklist + notification templates, platform admin from
# ADMIN_USERNAME/ADMIN_PASSWORD (upsert), demo tenant only when SEED_DEMO=true.
echo "[entrypoint] seed (SEED_DEMO=${SEED_DEMO:-false})"
node dist-seed/prisma/seed.js

echo "[entrypoint] starting API (ROLE=${ROLE:-all})"
exec node dist/main.js
