#!/usr/bin/env bash
# Avroleva - restore drill: load the newest db-*.dump (or the file given as $1) into a THROWAWAY
# postgres:16-alpine container (no network, no ports), run sanity queries, print them, remove the
# container. Never touches the production database. Run monthly, and after any Postgres upgrade.
#   /var/www/avroleva/scripts/restore-drill.sh            # newest dump in /root/backups/avroleva
#   /var/www/avroleva/scripts/restore-drill.sh /root/backups/avroleva/db-2026-09-08-0335.dump
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/root/backups/avroleva}"
PG_IMAGE="${PG_IMAGE:-postgres:16-alpine}"
DUMP="${1:-}"
if [ -z "$DUMP" ]; then
  DUMP="$(ls -1t "$BACKUP_DIR"/db-*.dump 2>/dev/null | head -1 || true)"
fi
if [ -z "$DUMP" ] || [ ! -f "$DUMP" ]; then
  echo "restore-drill: no dump found (BACKUP_DIR=$BACKUP_DIR, arg='${1:-}')" >&2
  exit 1
fi

NAME="avroleva-restore-drill-$$"
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "restore-drill: dump      $DUMP ($(du -h "$DUMP" | cut -f1))"
echo "restore-drill: container $NAME ($PG_IMAGE, network none)"
docker run -d --name "$NAME" --network none \
  -e POSTGRES_USER=drill -e POSTGRES_PASSWORD=drill -e POSTGRES_DB=drill "$PG_IMAGE" >/dev/null
for _ in $(seq 1 60); do
  if docker exec "$NAME" pg_isready -U drill -d drill >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$NAME" pg_isready -U drill -d drill >/dev/null

docker cp "$DUMP" "$NAME:/tmp/db.dump"
START="$(date +%s)"
# --no-owner/--no-privileges: the dump's role (POSTGRES_USER) does not exist here; that is fine.
docker exec "$NAME" pg_restore -U drill -d drill --no-owner --no-privileges --exit-on-error /tmp/db.dump
echo "restore-drill: pg_restore ok in $(( $(date +%s) - START ))s"

q() { docker exec "$NAME" psql -U drill -d drill -tAc "$1"; }
MIGRATIONS="$(q 'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL')"
LAST_MIGRATION="$(q 'SELECT migration_name FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 1')"
TENANTS="$(q 'SELECT count(*) FROM tenant')"
USERS="$(q 'SELECT count(*) FROM "user"')"
ELEVATORS="$(q 'SELECT count(*) FROM elevator')"
VISITS="$(q 'SELECT count(*) FROM visit')"
LAST_VISIT="$(q 'SELECT max("startedAt") FROM visit')"
ATTACHMENTS="$(q 'SELECT count(*) FROM attachment')"

cat <<REPORT
restore-drill: RESULT
  migrations applied : $MIGRATIONS (latest: $LAST_MIGRATION)
  tenants            : $TENANTS
  users              : $USERS
  elevators          : $ELEVATORS
  visits             : $VISITS (latest startedAt: ${LAST_VISIT:-none})
  attachments        : $ATTACHMENTS
REPORT

if [ "${TENANTS:-0}" -lt 1 ]; then
  echo "restore-drill: WARNING - zero tenants in the restored dump" >&2
  exit 2
fi
echo "restore-drill: OK - throwaway container removed"
