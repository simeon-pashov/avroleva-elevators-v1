# Avroleva — Handoff after step 5 (scheduler, notifications, exports + delete-my-data, monthly report)

Date: 2026-09-08. Read `ARCHITECTURE.md` (§2 A5/A7/A8, §3 notifications/reporting/platform tables, §5 exports, §6 scheduled jobs + data custody stance, §9 D8/D9/D20), `MVP-PLAN.md` phases 7–9 and `HANDOFF-STEP1..4.md` first; this file says what step 5 added, how the worker runs, what every job does and when, which env vars are new, what is missing, and what the final QA/deploy step needs.

Vocabulary rule kept: every template, page and log line is operational (посещение, авария, дефект, технически преглед, фактура, отчет, уведомление). No regulator-facing output exists; nothing names ДАМТН, закон or compliance.

## 1. What exists now

| Area | What |
|---|---|
| `platform/jobs` (L0, new) | **pg-boss 10** on the same Postgres, schema `pgboss` (D8/D9). `registry.ts` = `defineJob({name, cron?, handler, retryLimit…})` + `runJob(name, data)` with bookkeeping in `job_run` (last start/finish/status/error/duration/result). `boss.ts` = one instance per process, `enqueue(name, data, {singletonKey})` → pg-boss when the queue runs, else the handler on the next tick (tests, `WORKER_ENABLED=false`). |
| `platform/events/bus.ts` | The outbox is real now: `publish()` still writes `domain_event` in the caller's transaction; delivery = one `events.dispatch` job per `(eventId, handler)` (retry 5×, backoff), recorded in **`event_delivery`** so a redelivery never runs a handler twice; `subscribe(type, handler, name)` — the name keys the delivery row (renaming a handler re-delivers). `events.alreadyPublished()` / `latest()` are the dedupe primitives for the cron jobs; `events.sweep()` re-enqueues missing deliveries of the last 24 h (outbox catch-up when the worker was down). |
| `apps/api/src/jobs.ts` | The worker's composition root: every cron (§2). `worker.ts` = `startWorker()` (createQueue + work + schedule per job) / `stopWorker()`; `main.ts` starts HTTP and/or the worker by `ROLE`. |
| `modules/notifications` (L4, active) | Tables `notification_template` (system rows `tenantId NULL` per key/channel/locale + tenant overrides, Handlebars), `notification_rule` (tenantId, eventType, channel, recipientKind, enabled, config JSONB), `notification` (delivery log: channel, to, userId for in-app, subject, body, status queued/sent/failed/skipped, providerId, error, relatedType/Id, link, meta with the Viber links / e-mail attachments, readAt). Ports `EmailSender` (console, `smtp` via nodemailer), `SmsSender` (console, generic `http` gateway posting `{to,text}`), `ViberLinker` (deep-link mode only: `viber://chat?number=`, `viber://forward?text=`, `https://viber.click/<digits>`). `handleEvent` is the subscriber: rules → recipients (building contact / owner / office / assigned technician) → template (channel + locale, tenant row shadows system row, viber_link falls back to the sms text) → row → `notifications.deliver` job for e-mail/SMS; in-app rows are done on write; viber_link rows wait for the office to tap the link and press "изпратено". Idempotent per (event, channel, recipient). Templates ship in `packages/domain-data/notifications/templates.v1.json` (16 keys × email/sms/in_app × bg/en = 96 rows, `ensureSystemTemplates()` in every seed). Default rules (18, `RULE_MATRIX` in contracts) are created on a tenant's first read; SMS rows exist but start OFF. Office API: rules, templates (preview with sample data, save/reset an override, test-send), log, inbox (bell), mark-read, mark-sent, viber-link builder. |
| `modules/reporting` (L4) | **Exports**: `GET /exports/:dataset.csv` streams UTF-8 + BOM CSV (comma, CRLF, formula-injection guarded) for `elevators, buildings, customers, contacts, contracts, visits (one column per checklist item code), callbacks, defects, inspections, invoices, payments, notifications, audit`; `POST /exports/full` → `export_job` row + `exports.full` job → zip (`csv/*.csv`, `photos/<visitId>/<attachmentId>.jpg`, `README.txt` bg/en, `manifest.json` with SHA-256 per file) stored via `FileStorage` at `exports/<tenantId>/<jobId>.zip`, signed link `/files/export/:id?exp&sig` (24 h, HMAC bound to the tenant), in-app + e-mail `export_ready` to the requester; `GET /exports` lists runs with fresh links. **Monthly building report**: `buildingReport(ctx, buildingId, month)` DTO (per lift: visits with technicians / checklist summary / defects found, callbacks with response minutes, open defects, next check + inspection; invoices of the month + outstanding), rendered by `domain/buildingReportHtml.ts` (self-contained HTML, print CSS, Cyrillic font stack) for `GET /print/building-report/:buildingId?month=` and as the e-mail attachment of `POST /reports/building/:id/send` (`building_report` template to the contact with an e-mail); `POST /reports/building/bulk {month, send}`; every run logged as `report_run`; `GET /reports`. Reporting talks to notifications through the **`ReportNotifier` port** (same layer → no import; wired in `app.ts`). Dashboard gained `thisMonth {visits, callbacks, avgResponseMinutes}`. |
| `modules/tenancy` | **Delete-my-data** (data custody stance): `POST /tenant/delete-request {password}` (owner, password re-entered) → `status = deletion_scheduled`, `deletionAt = now + 30 d`, audit `tenant.deletionRequested`, event `TenantDeletionScheduled` (→ in-app + e-mail to the owners); `POST /tenant/delete-request/cancel` (owner) and `POST /admin/tenants/:id/cancel-deletion` (platform admin, at the owner's written request) while the date has not passed; `domain/deletion.ts` is the pure state machine. The tenant keeps working during the grace period; `GET /tenant` carries `deletionAt`. `listActiveTenantIds`, `listDueForDeletion`, `listNotifiableUsers` feed the jobs and the notifications module. Setting `retentionYears` (null = keep). |
| `platform/db/purge.ts` | `purgeTenantData(tenantId, fileKeys)` — the only hard delete: files through the storage port, then every table by SQL name in dependency order (`PURGE_ORDER`), then the tenant row, then one platform-level audit line (`tenant.purged`, `tenantId NULL`, actor `system`). |
| `modules/documents` | Retention: `purgeVisitPhotos(tenantId, visitIds)` (links + rows + files; an attachment still linked elsewhere is kept), `cleanupOrphans`, `storageKeysOf` (purge), `readBytes` (export); `domain/retention.ts` (`retentionCutoff`, 7-day orphan grace). `visits` gained `photosPurgedAt` (DTO field, set by the sweep; the record stays). |
| `modules/billing` | `rollStatuses()` now returns the rolled invoices and emits **`InvoiceOverdue`** once per invoice (runs from the daily job and, as before, before billing reads). |
| `http/admin.ts` | `GET /admin/system` = health + worker jobs, tenants with a scheduled deletion, event deliveries that exhausted their retries, failed notifications. `GET /api/v1/health` reports `worker {enabled, running, queued, jobs[{name, cron, lastStartedAt, lastFinishedAt, lastStatus, lastError, lastDurationMs}]}`. |
| office | See §5 (bell, Settings → Уведомления / Данни, notifications log, reports page, building Viber + report block, dashboard strip, CSV buttons, admin deletions). |
| seeds | `ensureSystemTemplates()` (notifications) in every seed; demo tenant: 18 default rules, six log rows (two in-app "нова авария", two in-app "просрочена фактура", one queued Viber link for a visit, one skipped e-mail), one completed full export (a real zip under `apps/api/data/exports/`). Idempotent: rules only when missing, log rows / export only while the tenant has none. |

## 2. Jobs and schedule (Europe/Sofia; all catch-up idempotent)

| Job | Cron | What it does | Dedupe |
|---|---|---|---|
| `maintenance.recompute` | `5 * * * *` (hourly) | `elevators.recomputeSchedule` per tenant: `nextCheckDueAt` from `lastCheckAt` + interval / strategy / override. | Pure recompute. |
| `billing.rollOverdue` | `10 0 * * *` | issued → overdue when `dueAt < today`; emits `InvoiceOverdue`. | Status change happens once. |
| `calendar.materialise` | `0 6 * * *` | From the deadlines view: `InspectionDueSoon` on the alert steps (90/60/30/7 or the tenant's `inspectionAlertDays`), `CheckOverdue` on day 1 overdue and every 7th day after, `DefectFollowUpDue` on the due day and every 7th day after. | `events.latest()` / `alreadyPublished(type, id, since 24 h)`. |
| `callbacks.slaWatch` | `* * * * *` | `CallbackSlaAtRisk` at 75 % of the tenant limit (45 of 60 min), `CallbackSlaBreached` at the limit, for open callbacks. | One event of each type per callback (`alreadyPublished`). |
| `documents.retentionSweep` | `0 3 * * 0` (Sun) | Tenants with `settings.retentionYears`: photos of visits started before `now − N years` are removed, `visit.photosPurgedAt` set. | Flag on the visit. |
| `attachments.cleanupOrphans` | `30 3 * * 0` (Sun) | Uploads older than 7 days that no visit links. | — |
| `tenancy.deletionSweep` | `30 3 * * *` | Tenants with `status = deletion_scheduled` and `deletionAt ≤ now` → `purgeTenantData` (files + tables), platform audit line. | Row is gone. |
| `events.sweep` | `*/5 * * * *` | Re-enqueues `events.dispatch` for events of the last 24 h with a missing delivery row; re-enqueues e-mail/SMS rows stuck in `queued` > 10 min. | `event_delivery` keys. |
| `events.dispatch` | queue | One (event, handler) delivery; retry 5×, 5 s backoff. | `event_delivery.status = done`. |
| `notifications.deliver` | queue | One queued e-mail / SMS row → adapter; 3 attempts, then `failed` with the error. | Row status. |
| `exports.full` | queue | Builds the zip, stores it, notifies the requester; `export_job` status queued → running → done/failed. | Job row. |

`GET /api/v1/health` (and `/admin/system`) show the last run per job. The cron `singletonKey` is the job name, so overlapping ticks collapse.

## 3. Running the worker

```bash
npm run dev                # ROLE=all (default): API + worker in one process; pg-boss schema created on first start
ROLE=api node dist/main.js     # HTTP only - pg-boss still started so the API can enqueue (exports, event delivery)
ROLE=worker node dist/main.js  # no HTTP: handlers + crons only ("run the worker separately" = a second container with this env)
WORKER_ENABLED=false           # no pg-boss at all: events delivered in-process, queue jobs run on the next tick, crons off (vitest sets this)
CRON_ENABLED=false             # queues only, no schedules (e.g. a second API replica)
```

Splitting API and worker later is a compose change: same image, one service with `ROLE=api`, one with `ROLE=worker`. pg-boss keeps completed jobs 1 day (archive) and deletes after 7. `npm run db:reset` also drops the `pgboss` schema.

Env added (`.env.example`): `ROLE`, `WORKER_ENABLED`, `CRON_ENABLED`, `EMAIL_PROVIDER=console|smtp`, `SMTP_URL`, `EMAIL_FROM`, `SMS_PROVIDER=console|http`, `SMS_HTTP_URL`, `SMS_HTTP_TOKEN`. Tenant setting added: `retentionYears`.

## 4. Notifications: how a rule fires

1. A module publishes an event (`VisitRecorded`, `CallbackOpened/Closed`, `CallbackSlaAtRisk/Breached`, `InvoiceIssued/Overdue`, `InspectionDueSoon`, `DefectFollowUpDue`, `CheckOverdue`, `StopLiftRequired`). `visits`, `callbacks`, `billing`, `calendar` know nothing about notifications.
2. `subscribers.ts` routes every notifiable type to `notifications.handleEvent` (handler name `notifications.rules`).
3. Enabled rules of the tenant for that type are matched (`InspectionDueSoon` also by `config.days`). Context is loaded through the modules' public queries (visit, callback, invoice, elevator, defect + building contacts + users).
4. Recipients: `building_contact` = contacts of the building (primary first; e-mail rule → first contact with an e-mail, else with `config.fallbackViberLink` a **Viber link** row to the first contact with a phone (Viber-flagged first), else a `skipped` row with the reason so the office sees the missing data); `owner` / `office` = active users by role, one row per user; `assigned_technician` = the callback's technician.
5. Template = `TEMPLATE_KEY_BY_EVENT[type]` + channel + locale (contact → tenant locale, user → user locale). Helpers: `{{date x}} {{datetime x}} {{money cents}} {{t "key"}} {{join list ", "}}`. Data keys: `tenant.*`, `building.addressText/customerName`, `elevator.internalNo/regNo`, `contact.name/phone/email`, `user.name`, `visit.date/kindLabel/technicians/summary/defects/notes/flags`, `callback.receivedAt/classificationLabel/description/trappedCount/responseMinutes/elapsedMinutes/slaMinutes/cause/actionTaken`, `invoice.number/period/totalCents/dueAt`, `inspection.dueAt/inDays`, `defect.description/recordedAt/followUpDueAt`, `check.dueAt/overdueDays`, `report.*`, `export.*`, `deletion.at`, `link`.
6. The row is written first, then the channel: in-app done, viber_link waits for the office (log page → "Изпрати по Viber" → "Маркирай като изпратено"), e-mail/SMS through the `notifications.deliver` job.

## 5. Office UI (step 5) and browser verification

Commit `b5a89b7` (feat(office): notifications, reports, exports and data settings UI):

| Where | What |
|---|---|
| Topbar | `NotificationsBell`: unread count from `GET /notifications/inbox`, dropdown with the latest rows, "mark read", link into the related record (polls every 60 s, refetches on focus). |
| `/notifications` (owner, office) | Delivery log: channel / status filters, subject + body preview, recipient, error text, "Отвори" link; Viber rows carry `ViberLinks` (`viber://chat`, `viber://forward?text=`, `viber.click`) and "Маркирай като изпратено". |
| `/settings/notifications` | `SettingsNav` tabs (Общи / Уведомления / Данни). Rule grid per event × channel × recipient with the `InspectionDueSoon` day steps (7/30/60/90); template editor with event / channel / language selectors, live preview on sample data, save an override / reset to the system row, test-send to yourself. |
| `/settings/data` | CSV export buttons for the 13 datasets (`ExportCsvButton`, owner/office only), "Подготви пълен експорт" + runs table with fresh signed links, retention years, the delete-my-data card (password re-entry, 30-day grace, cancel while pending; the tenant shows `deletionAt` in the topbar banner). |
| `/reports` | Month picker, "Генерирай за всички обекти", "Изпрати на всички обекти с имейл", the `report_run` list with open / send per building. |
| Building page | `BuildingReportCard` (open the printable report for a month, send to the contact) and `BuildingViberCard` (ready-made Viber text for the primary contact). |
| Dashboard | `ThisMonthStrip` (visits, callbacks, average response minutes) under the title. |
| Every list page | "Експорт CSV" button (elevators, buildings, customers, contracts, callbacks, defects, calendar). |
| Admin | Tenant list shows scheduled deletions; tenant detail can cancel a deletion at the owner's written request. |
| i18n | ~180 keys added to `bg.json` / `en.json`; the English pass of the QA crawl shows no raw keys or untranslated strings. |

Verification (2026-09-08, see `docs/QA-2026-09-08.md` for the whole pass): the bell shows the seeded inbox rows and marks them read; a recorded visit produces a queued Viber row for the building contact (no e-mail on file) and an e-mail row through the console adapter when the contact has one; the template preview renders bg/en with the date and money helpers; the full export finished in ~1 s for the demo tenant and the signed link downloaded a 350 KB zip; a 24-hour-old or tampered link answers 404; the building report for September rendered the visits and technicians of the month; the delete-request card refused a wrong password (403) and showed the 30-day date after the right one; the platform admin saw the scheduled deletion and cancelled it. Two things found and fixed during that pass belong to this step: the overdue roll emitted `InvoiceOverdue` several times per invoice under concurrent reads, and the outbox sweep delivered the seed's history as fresh notifications on the first start (commit `29b2216`).

Screenshots: `docs/screenshots/notifications.png` (log with Viber links), `notification-settings.png` (rules + template editor), `building-report.png` (printable monthly report), `data-settings.png` (exports, full export run, delete-my-data).

## 6. Tests

`npm test`: i18n 12; API unit 94 (`step5.test.ts` 19: rule matching incl. the InspectionDueSoon steps and the default matrix, template integrity for every key/channel/locale, Handlebars rendering with bg/en date + money helpers, no HTML escaping / text→HTML, broken-template detection, channel fallbacks, Viber digit normalisation + the three links, retention cutoff / orphan grace, deletion state machine, CSV quoting + formula guard + BOM, duplicate handler names); API integration 105 (`step5.test.ts` 24: default rules seeded per tenant and toggled without leaking to the other tenant, template preview bg/en + broken draft 400, tenant override shadows and resets, test-send in-app + e-mail through the console adapter, visit → e-mail to the building contact with exactly one `event_delivery` row, no e-mail → Viber link row with links + mark-sent (+ cross-tenant 404), callback → owner inbox + per-user read state, viber-link endpoint, delivery idempotency and retry of a failing handler, `billing.rollOverdue` once + in-app + e-mail, `callbacks.slaWatch` at-risk then breached once each with a fake clock, `calendar.materialise` idempotent and rule-off, `documents.retentionSweep` purging an old visit's photo and flagging the visit, `/health` job list, `elevators.csv` BOM/header/scoping/technician 403/unknown 404, `visits.csv` checklist columns, full export job → zip + signed link + tampered 404 + bell + cross-tenant 404, building report DTO + print page + bad month 400 + cross-tenant 404, send with attachment + `report_run` + noEmail skip, bulk, dashboard this-month, delete request (wrong password 403, 30-day date, 409 twice, audit, in-app, admin list + admin cancel, owner cancel), the sweep hard-deleting only tenant A with every table and the export file gone, tenant B counts unchanged, platform audit line). All green; `npm run lint` and `npm run build` green.

## 7. Known gaps (by design in step 5)

- Viber is deep-link only (Viber Business out of scope): the office taps `viber://forward?text=` on a device with Viber and confirms by hand; delivery is not verifiable.
- SMS: generic HTTP adapter only, no Bulgarian aggregator / Twilio adapter yet; SMS rules exist but start OFF.
- E-mail HTML is the plain text converted to paragraphs (no branded layout); the report goes as an HTML attachment, not a PDF (D10's Chromium renderer is not shipped).
- The full export builds the zip in memory (fine to a few hundred MB; stream to a temp file when a tenant grows past that) and photos are not re-verified against `attachment.sha256`. The audit CSV is not hash-chained (`audit_log` has no `prevHash/hash` columns yet — ARCHITECTURE §3 audit strategy (1) is still open); `manifest.json` covers the zip's integrity.
- `calendar_item` is not materialised as rows: `calendar.materialise` derives from the same read model as the office's "Срокове" page and only emits events. No `maintenance_job` table / technician-pair assignment (unchanged from step 4).
- Per-contact opt-out (MVP-PLAN phase 7) is not implemented; a rule is per tenant.
- Deletion during the grace period does not put the tenant into read-only mode (deliberate: the owner may still export and work); a `closed` tenant is never purged automatically.
- No UI for the platform admin's system page yet (`GET /admin/system` exists).
- pg-boss is exercised end-to-end manually (dev server: `/health` → `worker.running = true`, `job_run` rows appear); the automated tests call handlers directly with `WORKER_ENABLED=false`.

## 8. What the final QA / deploy step needs

- Docker image: `ROLE=all` in `docker-compose.prod.yml`; `SMTP_URL` + `EMAIL_FROM` for real e-mail (console until then); `DATA_DIR` volume now also holds `exports/`; the `pgboss` schema is created by the app on first start (the DB user needs `CREATE` on the database — the compose Postgres owner has it).
- `PUBLIC_BASE_URL` must be right before the first e-mail goes out (export links and report links are absolute through `urls.base()`).
- Backups: `pg_dump` now includes `pgboss` (harmless) — exclude with `--exclude-schema=pgboss` if the dump size matters.
- Migration `20260908040000_jobs_notifications_exports` (adds the `deletion_scheduled` enum value — `ALTER TYPE … ADD VALUE`, cannot run inside a transaction on older Postgres; Prisma handles it on PG 16).
- Smoke after deploy: `/api/v1/health` shows `worker.running = true` and `callbacks.slaWatch` with a `lastFinishedAt` within a minute; record a visit → the bell rings; `POST /exports/full` → a download link within a minute.
