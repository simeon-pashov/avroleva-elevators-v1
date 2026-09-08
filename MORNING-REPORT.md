# Avroleva — morning report (2026-09-08)

Everything below is committed on `main` in this folder. Nothing was pushed to GitHub and the VPS was not touched. Unverified claims are marked as such; everything else was exercised in a browser or a test run tonight.

## What was built overnight

| Step | What exists now | Handoff / screenshots |
|---|---|---|
| 1 Foundation | Monorepo (api/office/tech + contracts/i18n/domain-data), Prisma schema, sessions, platform admin, tenant registration, registry (customers, contacts, buildings with geocoding, elevators, contracts), CSV import with preview, office shell with bg/en. | `HANDOFF-STEP1.md` |
| 2 Dashboard | 30-day cycle engine, visits, light billing (gapless invoices, VAT, payments), dashboard read model: map with pins by due state, due board, payments widget, elevator panel. | `HANDOFF-STEP2.md`, `dashboard.png`, `elevator.png` |
| 3 Callbacks, defects, calendar | Callback flow with SLA timer, defect catalogue with follow-up clock and stop-lift ring, inspections and alarm tests, public QR page with fault form, printable defect notice / inspection request / QR labels. | `HANDOFF-STEP3.md`, `callbacks.png`, `defects.png`, `calendar.png`, `public-page.png`, `qr-labels.png` |
| 4 Technician app | Offline-first PWA: QR enrollment, device sessions, Today list, visit form with checklist snapshot, camera, second technician, outbox with idempotency keys, printable logbook page. | `HANDOFF-STEP4.md`, `tech-today.png`, `tech-visit.png`, `logbook-print.png` |
| 5 Scheduler, notifications, exports | pg-boss jobs (11), outbox delivery with retries, notification rules × channels × templates (bg/en, tenant overrides), delivery log and bell, CSV + full zip export, delete-my-data with 30-day grace, monthly building report (print + e-mail), admin system page. Office UI for all of it. | `HANDOFF-STEP5.md`, `notifications.png`, `notification-settings.png`, `data-settings.png`, `building-report.png` |
| 6 QA + deploy (tonight) | Full QA pass with 11 fixes, regression tests, production Docker image verified locally behind nginx, compose, nginx snippet, backup/restore/deploy scripts, CI workflow, `DEPLOY.md`, this report. | `docs/QA-2026-09-08.md`, `DEPLOY.md`, `tech-outbox-offline.png`, `admin-tenants.png` |

## Run it locally (five commands)

```bash
docker start unclecrm-db     # the shared dev Postgres (or: docker compose up -d db and set DATABASE_URL to :5436)
npm install
npm run db:reset             # drop + migrate + seed the demo tenant (dev DB only)
npm run dev                  # API :3005, office http://localhost:5175, technician app http://localhost:5176/tech/
npm test                     # 215 tests against avroleva_test
```

Logins: owner `demo` / `demo1234`, office `maria` / `demo1234`, technician `ivan` / `demo1234`, platform admin `admin` / `admin12345` at `http://localhost:5175/admin/login`. To try the phone app on the desktop: Потребители → "Свържи телефон" for Иван → open the printed URL in another browser profile.

## Status

- `npm run typecheck`: green (api, office, tech).
- `npm run lint`: green (eslint + prettier).
- `npm test`: **215 passed** (i18n 12; API unit 94 + integration 109), 0 failed. Three new regression tests tonight.
- `npm run build`: green (packages, api, office, tech incl. service worker).
- Docker: `docker/Dockerfile` built and run as a throwaway stack (`avroleva-verify`, port 3105) with the real nginx snippet in front: health with the worker running and `callbacks.slaWatch` ticking, login, dashboard with 19 pins, elevator page with photo thumbnails, `/avroleva/tech/` loads and enrolls a phone, logbook print page, public QR page, CSV export with BOM, `backup.sh` + `restore-drill.sh` (dump restored into a scratch container: 1 tenant, 20 elevators, 347 visits, 15 attachments). Stack removed afterwards. **Not verified:** service-worker registration inside the embedded browser (the file serves correctly; confirm the PWA install on a real phone after deploy), and the CI workflow has never run (no GitHub remote yet).

## Verified in the browser tonight (owner, office, technician, admin)

Every office route in Bulgarian and English at 1280 px and in Bulgarian at 820 px with zero console errors, zero failed API calls and zero raw i18n keys. Through the UI: visit from the dashboard and from the elevator page; callback open → dispatch → on site → close (response time computed, close-out visit recorded); stop-lift defect (map ring appears, resolve → disappears); inspection added; October invoices generated (12) and one paid; CSV export and full zip export (signed link, expired/tampered → 404); all six `/print/*` pages; public `/p/:token` page with a fault report (6th within the hour → 429); QR label sheet. Roles: technician gets 403 on money/users/exports/settings in the API and never sees them in the UI; office cannot manage users or the tenant. Admin: registered a new company, its owner saw an empty tenant and 404 on every demo-tenant id (incl. print pages), deactivate → 401, reactivate → login works. Technician app: enrolled with the office token, visit with photo online, API killed, second visit with photo recorded offline ("2 записа чакат"), API restarted, both visits arrived with photos. Details: `docs/QA-2026-09-08.md`.

## Bugs found and fixed in QA (11)

The two that mattered: (1) the overdue roll ran before every billing read, so concurrent page loads emitted `InvoiceOverdue` 3–5 times per invoice — the bell showed 99+ right after a reset; now one atomic `UPDATE … RETURNING`. (2) The seed's months of history were re-delivered by the outbox sweep as 266 fresh notifications on the first API start; the seed now acknowledges its own events. Also: the technician app was unreachable in the container (`/tech/` redirect loop) and photo URLs were double-prefixed behind `/avroleva/`; the top nav was clipped at 1280 px; technicians could see contract prices; there was no UI button to generate the month's invoices; small things (raw link label, favicons, a typecheck error, a gitignore rule). Full table in `docs/QA-2026-09-08.md`.

## Deviations from ARCHITECTURE / MVP-PLAN and why

- **PDF**: no Chromium renderer in the image. Every document is a print-ready HTML page (`/print/*`) and the monthly report goes out as an HTML attachment. Chromium adds ~250 MB and 150–250 MB RAM on a shared 3.8 GB VPS; the `PdfRenderer` port is where it plugs in when a customer needs PDF files.
- **Notifications**: Viber is deep-link only (office taps the link, confirms "sent"); SMS has a generic HTTP adapter only, rules start OFF; e-mail is plain text turned into paragraphs. No per-contact opt-out yet.
- **`calendar_item` and `maintenance_job` tables** are not materialised: the deadlines view derives from the read model and the cron only emits events. Simpler, and nothing needed the rows yet.
- **Audit log is not hash-chained** (`prevHash/hash` columns still open); the full export's `manifest.json` covers zip integrity.
- **`PUBLIC_BASE_URL` is the origin only** (`https://srv1662742.hstgr.cloud`), not `…/avroleva` as §7 says: the code appends `BASE_PATH` itself. `DEPLOY.md` and the env example are right; ARCHITECTURE §7 still has the old value.
- **Pricing/subscription module is a skeleton**: no plan rows, no `trialing` state, no usage snapshots — the demo tenant has no subscription concept at all. This is the largest open item from MVP-PLAN phase 6.
- **No Playwright suite committed** (the architecture calls for one nightly smoke). Tonight's browser scripts lived in a scratch folder; porting them is ~1 day.
- **Row-level security** not used (as decided in §6); isolation is enforced in the repos and covered by tests.

## Known gaps (rough sizes)

| Gap | Size |
|---|---|
| Pricing plans, subscription state, 3-month trial, usage counting, admin view of who pays | 3–4 days |
| PDF renderer (Chromium or Gotenberg sidecar) + branded e-mail layout | 2 days |
| Real SMS adapter for a Bulgarian aggregator; Viber Business adapter (flagged) | 1 day each |
| Per-contact notification opt-out; delivery webhooks | 1 day |
| Playwright e2e suite (port of tonight's scripts) + nightly run | 1 day |
| Audit hash chain + verifier script | 1 day |
| Offsite backup copy (restic → B2 / Storage Box) and UptimeRobot | 0.5 day |
| Full export streams to a temp file instead of memory (only matters past a few hundred MB) | 0.5 day |
| Read-only mode during the deletion grace period; admin UI for the system page | 0.5 day each |

## Deploy (summary — the exact commands are in `DEPLOY.md`)

1. Create the GitHub repo (private, empty), push `main` from this PC with the repo-local identity.
2. On the VPS: deploy key + `/root/.ssh/config` alias, clone to `/var/www/avroleva`, `cp .env.production.example .env` and fill the three secrets with `openssl rand -hex 32`, `SEED_DEMO=false` (or `true` for a demo tenant), `PUBLIC_BASE_URL=https://srv1662742.hstgr.cloud`.
3. `docker compose -f docker-compose.prod.yml up -d --build` → the container migrates, seeds the admin, starts API + worker on `127.0.0.1:3005`.
4. Copy `deploy/nginx-avroleva.conf` to `/etc/nginx/snippets/`, add one `include` line inside the existing `listen 443 ssl` server block, `nginx -t && systemctl reload nginx`; check the other five apps still return 200.
5. Health: `https://srv1662742.hstgr.cloud/avroleva/api/v1/health` shows `worker.running: true`. Log in at `/avroleva/admin/login`, register the first firm.
6. Cron `scripts/backup.sh` nightly; run `scripts/restore-drill.sh` once; rollback = `git checkout <previous tag> && up -d --build`.

## Decisions needed from you (in priority order)

1. **Domain, before any QR label is printed or any technician installs the app.** The PWA identity, its offline data and every printed QR code are bound to the origin. Path-prefix `srv…/avroleva/` is fine for demos; the founding customer must start on `app.<yourdomain>` (new server block + certbot). Also: the GitHub repo name.
2. **Production secrets and the admin account**: `SESSION_SECRET`, `POSTGRES_PASSWORD`, `ADMIN_PASSWORD` generated on the VPS (commands in `DEPLOY.md`); whether the platform admin username stays `admin`.
3. **Pricing configuration values**: per-elevator price, tiers (0/1–100/101–200), flat-plan option, VAT display, currency (EUR with BGN reference is what the UI shows now). Nothing is coded until you decide — see the gap table.
4. **3-month trial mechanics**: trial start = registration or first import? What happens at the end (read-only, grace, e-mail sequence)? Who flips a tenant to paying (you in /admin)?
5. **Notification channels to enable by default**: today in-app + e-mail rules are ON, SMS OFF, Viber deep-link ON for building contacts without e-mail. Which SMTP provider/sender address? Which SMS aggregator, if any?
6. **Viber Business or not**: ~€150/month fixed; deep links work today but are manual and unverifiable. Suggest deferring until ~10 paying firms.
7. **Keep the demo tenant in production?** `SEED_DEMO=true` gives you a sales demo at the same URL; it also means demo data sits next to real firms. Suggest: yes for now, purge before the first real invoice run.
8. Smaller: `retentionYears` default (keep everything vs. N years), e-mail "from" name, whether office users may see the Viber phone links (they do now), and the monthly report send day.
