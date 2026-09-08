#!/usr/bin/env bash
# Avroleva - deploy on the VPS: backup -> git pull -> docker compose build -> up -d -> wait for
# health -> confirm the other apps still answer 200 through nginx.
#   ssh -o BatchMode=yes root@187.127.84.59 /var/www/avroleva/scripts/deploy.sh
#   .../deploy.sh v0.5.0        # deploy a tag/commit instead of main (rollback = previous tag)
# Env overrides: APP_DIR, COMPOSE_FILE, PUBLIC_HOST, APP_PATH, OTHER_APPS, SKIP_BACKUP=true.
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/avroleva}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
PUBLIC_HOST="${PUBLIC_HOST:-srv1662742.hstgr.cloud}"
APP_PATH="${APP_PATH:-/avroleva}"
OTHER_APPS="${OTHER_APPS:-/uncle-crm/ /smart-flower-pots/ /kontira/ /food-tracker/ /rumen-site/}"
SKIP_BACKUP="${SKIP_BACKUP:-false}"
GIT_REF="${1:-}"

log() { printf '%s [deploy] %s\n' "$(date '+%F %T')" "$*"; }
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$1" || echo 000; }

cd "$APP_DIR"
if [ ! -f .env ]; then
  echo "deploy: $APP_DIR/.env missing (copy .env.production.example)" >&2
  exit 1
fi
set -a
# shellcheck disable=SC1091
. ./.env
set +a
HOST_PORT="${APP_HOST_PORT:-3005}"
compose() { docker compose -f "$COMPOSE_FILE" "$@"; }

log "1/6 backup"
if [ "$SKIP_BACKUP" = "true" ]; then
  log "  skipped (SKIP_BACKUP=true)"
elif [ -z "$(compose ps -q db 2>/dev/null)" ]; then
  log "  skipped (db not running - first deploy)"
else
  LOG_FILE=- "$APP_DIR/scripts/backup.sh"
fi

log "2/6 git pull"
BEFORE="$(git rev-parse --short HEAD)"
git fetch --tags --prune origin
if [ -n "$GIT_REF" ]; then
  git checkout --detach "$GIT_REF"
else
  git checkout -q main
  git pull --ff-only origin main
fi
log "  $BEFORE -> $(git rev-parse --short HEAD) ($(git log -1 --format=%s))"

log "3/6 docker compose build"
compose build app

log "4/6 docker compose up -d"
compose up -d --remove-orphans

log "5/6 waiting for /api/v1/health on 127.0.0.1:$HOST_PORT"
HEALTH="http://127.0.0.1:$HOST_PORT/api/v1/health"
STATUS=000
for _ in $(seq 1 60); do
  STATUS="$(code "$HEALTH")"
  if [ "$STATUS" = "200" ]; then break; fi
  sleep 3
done
if [ "$STATUS" != "200" ]; then
  log "  FAILED: health is $STATUS after 180s - last app logs:"
  compose logs --tail=80 app
  exit 1
fi
log "  container health: $(curl -s --max-time 15 "$HEALTH" | head -c 300)"
log "  via nginx https://$PUBLIC_HOST$APP_PATH/api/v1/health -> $(code "https://$PUBLIC_HOST$APP_PATH/api/v1/health")"
log "  via nginx https://$PUBLIC_HOST$APP_PATH/ -> $(code "https://$PUBLIC_HOST$APP_PATH/")"
log "  via nginx https://$PUBLIC_HOST$APP_PATH/tech/ -> $(code "https://$PUBLIC_HOST$APP_PATH/tech/")"

log "6/6 other apps through nginx"
FAILED=0
for p in $OTHER_APPS; do
  C="$(code "https://$PUBLIC_HOST$p")"
  log "  $p -> $C"
  case "$C" in
    200 | 301 | 302) ;;
    *) FAILED=1 ;;
  esac
done
if [ "$FAILED" != 0 ]; then
  log "  WARNING: another app is not answering 200 - check nginx (nginx -t) and docker ps"
fi
log "done: $(git rev-parse --short HEAD)"
