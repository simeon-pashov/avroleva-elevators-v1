#!/usr/bin/env bash
# Avroleva - backup on the VPS: pg_dump (custom format) of the database + tar of the data volume
# (attachments, exports) into /root/backups/avroleva/, 30-day retention, appended log.
# Same pattern as /root/backup-kontira.sh and /root/backup-rumen-site.sh (VPS-GUIDE). Cron:
#   35 3 * * * /var/www/avroleva/scripts/backup.sh
# Restore: scripts/restore-drill.sh (database, into a throwaway container) and DEPLOY.md.
#
# Overridable for a local run: APP_DIR, ENV_FILE, BACKUP_DIR, LOG_FILE (- = stdout), RETENTION_DAYS,
# COMPOSE_PROJECT_NAME (compose reads it), COMPOSE_FILE.
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/avroleva}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-$APP_DIR/.env}"
BACKUP_DIR="${BACKUP_DIR:-/root/backups/avroleva}"
LOG_FILE="${LOG_FILE:-/var/log/backup-avroleva.log}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
STAMP="$(date +%Y-%m-%d-%H%M)"

if [ "$LOG_FILE" != "-" ]; then
  mkdir -p "$(dirname "$LOG_FILE")"
  exec >>"$LOG_FILE" 2>&1
fi
log() { printf '%s [backup] %s\n' "$(date '+%F %T')" "$*"; }

cd "$APP_DIR"
# POSTGRES_* come from the same untracked .env the containers use.
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
: "${POSTGRES_USER:?POSTGRES_USER missing in $ENV_FILE}"
POSTGRES_DB="${POSTGRES_DB:-avroleva}"
compose() { docker compose -f "$COMPOSE_FILE" "$@"; }

mkdir -p "$BACKUP_DIR"
log "start -> $BACKUP_DIR"

# 1. Database (custom format = pg_restore, compressed). Includes the pgboss schema (harmless; add
#    --exclude-schema=pgboss if the size ever matters). Written to .part and renamed when complete.
DB_FILE="$BACKUP_DIR/db-$STAMP.dump"
compose exec -T db pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB" >"$DB_FILE.part"
mv "$DB_FILE.part" "$DB_FILE"
log "database: $DB_FILE ($(du -h "$DB_FILE" | cut -f1))"

# 2. Data volume (/data in the app: attachments/, exports/). The volume is resolved from the app
#    container's mounts so the compose project name does not matter.
APP_CONTAINER="$(compose ps -aq app | head -1 || true)"
DATA_VOLUME=""
if [ -n "$APP_CONTAINER" ]; then
  DATA_VOLUME="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' "$APP_CONTAINER")"
fi
if [ -z "$DATA_VOLUME" ]; then
  DATA_VOLUME="${COMPOSE_PROJECT_NAME:-$(basename "$APP_DIR" | tr '[:upper:]' '[:lower:]')}_avroleva_data"
  log "app container not found; assuming volume $DATA_VOLUME"
fi
DATA_FILE="data-$STAMP.tar.gz"
docker run --rm -v "$DATA_VOLUME:/d:ro" -v "$BACKUP_DIR:/b" alpine \
  sh -c "tar czf /b/$DATA_FILE.part -C /d . && mv /b/$DATA_FILE.part /b/$DATA_FILE"
log "data volume $DATA_VOLUME: $BACKUP_DIR/$DATA_FILE ($(du -h "$BACKUP_DIR/$DATA_FILE" | cut -f1))"

# 3. Retention: keep RETENTION_DAYS days of both kinds.
DELETED="$(find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'db-*.dump' -o -name 'data-*.tar.gz' \) \
  -mtime +"$RETENTION_DAYS" -print -delete | wc -l)"
log "retention: removed $DELETED file(s) older than $RETENTION_DAYS days"
log "done: $(find "$BACKUP_DIR" -maxdepth 1 -type f | wc -l) file(s), $(du -sh "$BACKUP_DIR" | cut -f1) total"
