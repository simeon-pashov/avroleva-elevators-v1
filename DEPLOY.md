# Avroleva Elevators — deployment runbook (VPS `srv1662742.hstgr.cloud`)

Command-oriented. Conventions come from `D:\Code\VPS-GUIDE.md` and `D:\Code\GITHUB-GUIDE.md`
(one host nginx, path prefix per app, Docker Compose, deploy key per repo, secrets only in an
untracked `.env` on the VPS). Everything below runs as `root@187.127.84.59` unless stated.

| What | Value |
|---|---|
| Public URL | `https://srv1662742.hstgr.cloud/avroleva/elevators-v1/` (office), `/avroleva/elevators-v1/tech/` (technician PWA), `/avroleva/elevators-v1/downloads/` (Android APK + install page), `/avroleva/elevators-v1/api/v1/` |
| Code on the VPS | `/var/www/avroleva` (clone of `github.com/simeon-pashov/avroleva-elevators-v1`, private) |
| Compose | `docker-compose.prod.yml` → services `db` (postgres:16-alpine, volume `avroleva_db`) and `app` (`127.0.0.1:3005`, volume `avroleva_data` at `/data`) |
| Image | `docker/Dockerfile` (multi-stage; ~600 MB; entrypoint = `prisma migrate deploy` → bootstrap seed → `node dist/main.js`, worker inside via `ROLE=all`) |
| Health | `https://srv1662742.hstgr.cloud/avroleva/elevators-v1/api/v1/health` → `{"ok":true,"db":"up",...,"worker":{"running":true,...}}` |
| Backups | `scripts/backup.sh` → `/root/backups/avroleva/`, log `/var/log/backup-avroleva.log`, 30 days |

## 1. One-time: deploy key + clone (GITHUB-GUIDE pattern)

The repo is `simeon-pashov/avroleva-elevators-v1` (moved from `elevator-business` on 2026-09-19). GitHub
forbids reusing a deploy key across repos, so the new repo gets its own key + alias
(`github-avroleva-elevators-v1`); the old `github-avroleva` alias stays bound to the old repo.

```bash
ssh -o BatchMode=yes root@187.127.84.59 bash -s <<'EOF'
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_avroleva-elevators-v1 -N "" -C "vps-deploy-avroleva-elevators-v1"
cat >> ~/.ssh/config <<'CFG'

Host github-avroleva-elevators-v1
    HostName github.com
    User git
    IdentityFile ~/.ssh/id_ed25519_avroleva-elevators-v1
    IdentitiesOnly yes
CFG
chmod 600 ~/.ssh/config
echo "=== ADD AS READ-ONLY DEPLOY KEY ON THE REPO: ==="
cat ~/.ssh/id_ed25519_avroleva-elevators-v1.pub
EOF
```

Add the printed key at `github.com/simeon-pashov/avroleva-elevators-v1/settings/keys` (Add deploy key, **write access unchecked**), then:

```bash
ssh -o BatchMode=yes root@187.127.84.59 bash -s <<'EOF'
ssh -o StrictHostKeyChecking=accept-new -T git@github-avroleva-elevators-v1 || true   # "Hi simeon-pashov/avroleva-elevators-v1!"
git clone git@github-avroleva-elevators-v1:simeon-pashov/avroleva-elevators-v1.git /var/www/avroleva
cd /var/www/avroleva && chmod +x scripts/*.sh
ss -tlnp | grep -E ':(3005|3004)\b' || echo "port 3005 free"
EOF
```

## 2. One-time: `.env` (secrets stay on the VPS)

```bash
ssh -o BatchMode=yes root@187.127.84.59 bash -s <<'EOF'
cd /var/www/avroleva
cp .env.production.example .env
sed -i "s#^POSTGRES_PASSWORD=.*#POSTGRES_PASSWORD=$(openssl rand -hex 32)#" .env
sed -i "s#^SESSION_SECRET=.*#SESSION_SECRET=$(openssl rand -hex 32)#" .env
sed -i "s#^ADMIN_PASSWORD=.*#ADMIN_PASSWORD=$(openssl rand -hex 16)#" .env
chmod 600 .env
grep -E '^(APP_HOST_PORT|BASE_PATH|VITE_BASE|PUBLIC_BASE_URL|COOKIE_SECURE|SEED_DEMO)=' .env
EOF
```

Expected: `APP_HOST_PORT=3005`, `BASE_PATH=/avroleva/elevators-v1`, `VITE_BASE=/avroleva/elevators-v1/`,
`PUBLIC_BASE_URL=https://srv1662742.hstgr.cloud` (origin only — the app appends `BASE_PATH` itself
when it builds QR, enrollment and e-mail links), `COOKIE_SECURE=true`, `SEED_DEMO=false`.
`COOKIE_SECURE=true` is mandatory behind the HTTPS nginx (the local Docker verification runs with
`false` only because there is no TLS on `127.0.0.1`). E-mail/SMS stay on `console` until `SMTP_URL`
/ an SMS gateway are configured (see the comments in `.env.production.example`). The admin password
is written to `.env` by the command above; read it with `grep ADMIN_PASSWORD .env` and store it in
the password manager — it is upserted at every container start, so changing it there and
restarting the app resets it.

## 3. First start

```bash
ssh -o BatchMode=yes root@187.127.84.59 bash -s <<'EOF'
cd /var/www/avroleva
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml logs -f app     # Ctrl-C once you see "Avroleva Elevators API listening"
EOF
```

Expected in the log, in order: `[entrypoint] prisma migrate deploy` (5 migrations applied),
`[entrypoint] seed` → `system checklist templates ensured`, `system notification templates ensured`,
`platform admin ensured`, `SEED_DEMO is not true - demo tenant skipped`, then `Avroleva Elevators API listening`
and `pg-boss started` / job registrations. Container health:

```bash
ssh -o BatchMode=yes root@187.127.84.59 'curl -s http://127.0.0.1:3005/api/v1/health; echo; docker compose -f /var/www/avroleva/docker-compose.prod.yml ps'
```

## 4. nginx: include the snippet in the `listen 443 ssl` server block

`deploy/nginx-avroleva.conf` holds the location blocks (`= /avroleva/elevators-v1` → 302, `/avroleva/elevators-v1/assets/` and
`/avroleva/elevators-v1/tech/assets/` immutable cache, `/avroleva/elevators-v1/` → `proxy_pass http://127.0.0.1:3005/` with
`client_max_body_size 25M`, `proxy_read_timeout 120s`, no websocket). It defines **only**
`/avroleva/elevators-v1…` locations. The bare brand path `/avroleva/` belongs to the Avroleva brand site
(repo `simeon-pashov/avroleva`, its own snippet `/etc/nginx/snippets/avroleva-site.conf` with its own
`include` in `apps.conf`) — never add `/avroleva` or `/avroleva/` locations here. (The temporary 302 that
lived here between 2026-09-21 and the brand-site launch is gone.)

```bash
ssh -o BatchMode=yes root@187.127.84.59 bash -s <<'EOF'
set -e
cp /etc/nginx/sites-available/apps.conf /etc/nginx/sites-available/apps.conf.bak-$(date +%Y%m%d%H%M%S)
install -m 644 /var/www/avroleva/deploy/nginx-avroleva.conf /etc/nginx/snippets/avroleva.conf
grep -n 'listen 443 ssl\|location /rumen-site/\|include /etc/nginx/snippets/avroleva.conf' /etc/nginx/sites-available/apps.conf
EOF
```

Then add **one line** inside the existing `server { ... listen 443 ssl ... }` block, after the last
app location (`/rumen-site/`) and before the certbot-managed `listen 443 ssl` lines:

```nginx
    include /etc/nginx/snippets/avroleva.conf;
```

(e.g. `nano /etc/nginx/sites-available/apps.conf`, or, if the rumen-site block is the last one:
`sed -i '/location \/rumen-site\/ {/,/^    }/{/^    }/a\    include /etc/nginx/snippets/avroleva.conf;
}' apps.conf` — check the result with `nginx -T | grep -n avroleva` before reloading). Then:

```bash
ssh -o BatchMode=yes root@187.127.84.59 'nginx -t && systemctl reload nginx'
```

**certbot:** nothing to do. The Let's Encrypt cert covers the whole hostname and the path prefix
needs no new certificate. certbot is only needed later for a **custom domain** (section 9).

## 5. Verify through nginx (and that the other apps still answer)

```bash
H=https://srv1662742.hstgr.cloud
curl -s -o /dev/null -w "avroleva health %{http_code}\n" $H/avroleva/elevators-v1/api/v1/health
curl -s $H/avroleva/elevators-v1/api/v1/health | head -c 300; echo
curl -s -o /dev/null -w "office %{http_code}\n"  $H/avroleva/elevators-v1/
curl -s -o /dev/null -w "tech %{http_code}\n"    $H/avroleva/elevators-v1/tech/
curl -s $H/avroleva/elevators-v1/ | grep -o '/avroleva/elevators-v1/assets/[^"]*' | head -2        # asset links carry the prefix
curl -s -o /dev/null -w "admin login page %{http_code}\n" $H/avroleva/elevators-v1/admin/login
for p in /uncle-crm/ /smart-flower-pots/ /kontira/ /food-tracker/ /rumen-site/; do
  curl -s -o /dev/null -w "$p %{http_code}\n" $H$p
done
```

Health must show `"db":"up"`, `"worker":{"enabled":true,"running":true,...}` and, a minute after
start, `callbacks.slaWatch` with a recent `lastFinishedAt`.

## 6. First platform admin and first tenant

The platform admin (`ADMIN_USERNAME` / `ADMIN_PASSWORD` from `.env`) is **upserted at every
start** — there is no separate "create admin" command. Log in at
`https://srv1662742.hstgr.cloud/avroleva/elevators-v1/admin/login`, create the first tenant (firm) and its owner
user there; the owner then logs in at `/avroleva/elevators-v1/` and connects technicians' phones from
**Users → connect a phone** (QR / one-time code) in the PWA at `/avroleva/elevators-v1/tech/`.

To rotate the admin password: edit `ADMIN_PASSWORD` in `.env`, then
`docker compose -f docker-compose.prod.yml up -d app` (recreates the container; the seed upserts).

## 7. Deploy an update (manual, no deploy workflow yet)

```bash
ssh -o BatchMode=yes root@187.127.84.59 /var/www/avroleva/scripts/deploy.sh
```

`scripts/deploy.sh` = backup → `git pull --ff-only origin main` → `docker compose build app` →
`up -d` → wait for `/api/v1/health` = 200 on `127.0.0.1:3005` → prints the health JSON and the
status of `/avroleva/elevators-v1/`, `/avroleva/elevators-v1/tech/` and the five other apps through nginx. Deploy window
06:00–07:00 Sofia (ARCHITECTURE section 7); the swap costs 10–30 s. Migrations run inside the
container before the API starts (`prisma migrate deploy`).

**Android app (step 10).** The server does not build the APK; it serves whatever sits at
`DATA_DIR/releases/tech.apk` on the `avroleva_data` volume as `/avroleva/elevators-v1/downloads/tech.apk`
(install page with QR at `/avroleva/elevators-v1/downloads/`). After building a release on the laptop
(`docs/ANDROID-RELEASE.md` §3) copy it there:

```bash
scp "D:\Code\Avroleva\Avroleva Elevators\Releases\avroleva-elevators-tech-<version>.apk" root@187.127.84.59:/tmp/tech.apk
ssh root@187.127.84.59 "docker run --rm -v avroleva_avroleva_data:/d -v /tmp:/s:ro alpine sh -c 'mkdir -p /d/releases && cp /s/tech.apk /d/releases/tech.apk' && rm /tmp/tech.apk"
curl -sI https://srv1662742.hstgr.cloud/avroleva/elevators-v1/downloads/tech.apk | grep -i -E "^HTTP|content-type|content-length"
```

Keep `MIN_CLIENT_VERSION` in `.env` at or below the shipped app version. The APK is part of the
data volume backup (`scripts/backup.sh`), so a restore brings it back.

## 8. Backups, restore drill, rollback

```bash
# cron (crontab -e as root) - DB dump + data volume tar, 30-day retention, log /var/log/backup-avroleva.log
35 3 * * * /var/www/avroleva/scripts/backup.sh
# monthly restore drill into a throwaway postgres container (prints tenant/elevator/visit counts)
0 4 1 * * /var/www/avroleva/scripts/restore-drill.sh >> /var/log/backup-avroleva.log 2>&1
```

Run them by hand the first time:

```bash
ssh -o BatchMode=yes root@187.127.84.59 bash -s <<'EOF'
/var/www/avroleva/scripts/backup.sh && tail -5 /var/log/backup-avroleva.log
ls -la /root/backups/avroleva/
/var/www/avroleva/scripts/restore-drill.sh
EOF
```

**Restore for real** (database, into the running stack — stop the app first so nothing writes):

```bash
cd /var/www/avroleva && set -a && . ./.env && set +a
docker compose -f docker-compose.prod.yml stop app
docker compose -f docker-compose.prod.yml exec -T db psql -U $POSTGRES_USER -d postgres \
  -c "DROP DATABASE IF EXISTS ${POSTGRES_DB}_restore;" -c "CREATE DATABASE ${POSTGRES_DB}_restore;"
docker compose -f docker-compose.prod.yml exec -T db pg_restore -U $POSTGRES_USER -d ${POSTGRES_DB}_restore --no-owner < /root/backups/avroleva/db-<stamp>.dump
# sanity-check ${POSTGRES_DB}_restore with psql, then swap the names:
docker compose -f docker-compose.prod.yml exec -T db psql -U $POSTGRES_USER -d postgres \
  -c "ALTER DATABASE $POSTGRES_DB RENAME TO ${POSTGRES_DB}_old;" -c "ALTER DATABASE ${POSTGRES_DB}_restore RENAME TO $POSTGRES_DB;"
# attachments + exports (data volume):
docker run --rm -v avroleva_avroleva_data:/d -v /root/backups/avroleva:/b:ro alpine sh -c 'cd /d && tar xzf /b/data-<stamp>.tar.gz'
docker compose -f docker-compose.prod.yml start app
```

**Rollback** = previous tag + rebuild. Migrations are backward compatible by rule (ARCHITECTURE A10:
destructive changes ship two releases after the code stopped using the column), so the older
image runs against the newer schema:

```bash
ssh -o BatchMode=yes root@187.127.84.59 '/var/www/avroleva/scripts/deploy.sh v0.5.0'   # any tag or commit
# back to main later: ssh ... /var/www/avroleva/scripts/deploy.sh
```

Tag releases before deploying (`git tag v0.5.0 && git push --tags`) so there is always something to roll back to.

## 9. Custom domain (later — before QR labels and phone installs)

No certbot for the path prefix. For a domain (`app.avroleva.bg` as the example) add a **new server
block** next to `apps.conf`, get a cert for that hostname only, and point the same container at `/`:

```nginx
# /etc/nginx/sites-available/avroleva.conf  (ln -s into sites-enabled, nginx -t, reload)
server {
    listen 80;
    server_name app.avroleva.bg;
    return 301 https://$host$request_uri;
}
server {
    listen 443 ssl http2;
    server_name app.avroleva.bg;
    ssl_certificate     /etc/letsencrypt/live/app.avroleva.bg/fullchain.pem;   # certbot --nginx -d app.avroleva.bg
    ssl_certificate_key /etc/letsencrypt/live/app.avroleva.bg/privkey.pem;
    client_max_body_size 25M;
    location / {
        proxy_pass http://127.0.0.1:3005;          # no prefix to strip
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}
```

and in `.env`: `BASE_PATH=/`, `VITE_BASE=/`, `PUBLIC_BASE_URL=https://app.avroleva.bg` (origin), then
`docker compose -f docker-compose.prod.yml up -d --build` (the SPAs must be rebuilt for the new base).
Keep the `/avroleva/elevators-v1/` blocks for a while with a redirect to the domain so old links keep working.

## 10. Decisions before go-live

1. **Custom domain first — before the first printed QR labels and before technicians install the
   PWA.** The PWA's identity, its service-worker scope and its IndexedDB are bound to the origin;
   printed QR codes carry `PUBLIC_BASE_URL`. Moving from `srv1662742.hstgr.cloud/avroleva/elevators-v1/` to a
   domain later means every phone reinstalls and re-syncs, and every printed label needs a
   permanent redirect. The prefix is right for demos; the founding customer starts on the domain
   (section 9).
2. **Production secrets: admin password, `SESSION_SECRET`, `POSTGRES_PASSWORD`, and the SMTP/SMS
   credentials.** Generate them on the VPS (`openssl rand -hex 32`), keep the admin password in the
   password manager (it lives in `.env` and is upserted at every start), never reuse the dev values
   (`admin12345`, `dev-secret-change-me` — the app refuses to start with the dev secret in
   production), and decide who holds the `.env` file. Rotating `SESSION_SECRET` logs everyone out
   and invalidates signed file URLs; do it before the first customer, not after.
