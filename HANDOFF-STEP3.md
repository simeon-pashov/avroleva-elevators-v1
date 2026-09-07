# Avroleva — Handoff after step 3 (callbacks, defects, calendar, public QR page)

Date: 2026-09-08. Read `ARCHITECTURE.md`, `MVP-PLAN.md` (phases 4–5), `HANDOFF-STEP1.md` and `HANDOFF-STEP2.md` first; this file says what step 3 added, how it is wired, and what step 4 (the offline technician PWA) needs from the API.

Vocabulary rule kept: every user-visible string is operational (авария, дефект, технически преглед, срокове); nothing is addressed to a regulator and the words "ДАМТН" / "compliance" / "закон" do not appear in the UI. The catalogue file carries only the item number ("т. 7") as its reference.

## 1. What exists now

| Area | What |
|---|---|
| `packages/domain-data` (new workspace) | Reference data seeded, not coded (A6): `defects/art10.v1.json` (17 numbered stop-lift items + free-text "other", bg/en labels), `calendar-rules.json` (inspection 12 months, first 24, alerts 90/60/30/7, follow-up 30 days, callback limit 60 min). Loaded at runtime by `src/index.ts`; tenant settings override the rules. |
| `modules/callbacks` (L3) | Tables `callback`, `callback_event`. Intake from the office, a technician's own phone or the public page; dispatch; on-site / released / restored; close with cause, action, chargeable flag; close-out visit through a **`VisitRecorder` port** (declared in `callbacks/domain/ports.ts`, wired to `visits.record` in `app.ts`). SLA timer: `responseMinutes`, `elapsedMinutes`, `slaState` (ok / at_risk at 75 % / breached) computed on read from the per-callback `slaMinutes` snapshot. Every transition appends an event with provenance (`at`, `receivedAt`, `source` office \| app \| public, `byUserId`). |
| `modules/defects` (L3) | Table `defect`. Catalogue picker, free text, severity, stop-lift. A stop-lift defect on an active elevator calls `registry.elevators.setStatus(… 'stopped_by_firm', reason)` in the same transaction (audit entry + `ElevatorStatusChanged`); resolving the last open stop-lift defect restores `active`. Status flow open → notified (`noticeSentAt`) → awaiting_approval (`customerRequestedAt`) → scheduled → resolved (`resolvedAt`); `followUpDueAt` = recorded day (Sofia) + `settings.defectFollowUpDays`. |
| `modules/calendar` (L3) | Tables `inspection`, `alarm_device_test`. Inspections with kind, requested/scheduled/performed dates, result, body, findings JSONB `[{text, deadline, closed}]`, `nextDueAt` (explicit, else performedAt + interval; the first inspection of a lift uses the longer interval; failed/pending → none). `elevator.nextInspectionAt` follows the latest performed inspection through `registry.elevators.setNextInspection`. Alarm-device (voice link) tests per elevator. |
| `modules/reporting` (L4) | `GET /dashboard` extended (open callbacks summary, defects summary, 30-day deadline counts, per-pin `stopLift` / `openCallbacks`); **`GET /calendar`** = the merged deadlines list (inspections due or scheduled, checks overdue, defect follow-ups, callbacks over the limit, alarm tests due) computed on read from the modules' public queries. |
| `http/print.ts` (facade) | Printable HTML pages for signed-in users (print CSS, Cyrillic font stack, no PDF engine): `/print/defect-notice/:id`, `/print/inspection-request/:elevatorId?from&to`, `/print/label/:elevatorId`, `/print/labels/building/:buildingId` (QR as inline SVG from the `qrcode` package). |
| `http/public.ts` (facade) | `GET /p/:token` — server-rendered, mobile-first page (firm, emergency phone as `tel:`, address, elevator, status, last visit, next inspection month) and `POST /p/:token/report` (honeypot, 20/h per IP, 5/h per elevator) creating a `public_page` callback. Feature flags `publicQrPage`, `publicFaultReport` (`tenant.features`, typed in `contracts/tenancy.ts`). |
| registry | `elevator.publicToken` (32 hex = 128 bits, `@unique`, rotatable via `POST /elevators/:id/rotate-token`), `stoppedAt`, `stopReason`; commands `setStatus`, `setNextInspection`, `findByPublicToken` (the one unscoped read, documented in the repo). `ElevatorDetailDto` carries `publicToken` + `publicUrl` (built by `platform/urls.ts`, A11). |
| tenancy | Settings `inspectionIntervalMonths`, `firstInspectionIntervalMonths`, `inspectionAlertDays`, `alarmTestIntervalMonths` (all optional overrides), `features` on the DTO and on `PATCH /tenant`, `getTenantFeatures()`. |
| contracts | `callbacks.ts`, `defects.ts`, `calendar.ts`; **`patchOf()`** in `common.ts` (see §6). |
| office | Pages "Аварии", "Дефекти", "Календар"; dashboard widgets "Открити аварии" and the "Срокове" strip between the map and the due widget (layout map → callbacks → deadlines → due \| payments kept); elevator tabs Аварии / Дефекти / Прегледи; QR label / public page / rotate-token on the elevator page; "Етикети за целия обект" on the building page; settings for the new intervals and the two flags; pins get a dark ring for an open stop-lift defect and a pulsing red ring for an open callback. |
| seed | 15 historical + 2 open callbacks (varied classification, channel and response time, some over the limit), 6 open + 2 resolved defects (2 stop-lift on the already-stopped elevators), one performed inspection per elevator with next dates spread over the next 14 months (every 5th overdue) plus 2 scheduled ones, alarm tests for half the active elevators; demo tenant flags ON, `alarmTestIntervalMonths = 6`. Idempotent (`prisma/seed/step3.ts`). |

Screenshots: `docs/screenshots/dashboard.png`, `callbacks.png`, `calendar.png`, `public-page.png`.

## 2. How to run

```bash
docker start unclecrm-db
npm install                  # new workspace packages/domain-data, qrcode
npm run db:migrate           # or: npm run db:deploy -w apps/api  (see §4 about the renamed migration)
npm run db:seed
npm run dev                  # API :3005, office :5175 (Vite proxies /api, /print and /p)
npm test                     # i18n 12 + API 121 (unit 59, integration 62)
npm run lint && npm run build
```

Logins unchanged: `demo` / `maria` / `ivan` (`demo1234`), platform admin `admin` / `admin12345`.

## 3. API added (`/api/v1`; RFC 7807 errors; cross-tenant → 404)

Callbacks (any role may open; technicians see only callbacks assigned to them or opened by them, are auto-assigned when they open one, and cannot dispatch)
- `POST callbacks { id?, elevatorId, channel, classification, trappedCount?, callerName?, callerPhone?, description, receivedAt?, assignedUserId?, notes? }` → 201 `CallbackDto` (idempotent on `id`; `assignedUserId` = dispatch on intake; future `receivedAt` → 400 `callbacks.receivedInFuture`).
- `POST callbacks/:id/dispatch { userId, at? }` (owner/office), `POST callbacks/:id/on-site | released | restored { at?, notes? }`, `POST callbacks/:id/close { at?, cause, actionTaken, chargeable, chargeReason?, notes?, createVisit=true }` (records a `visit` of kind `callback` and stores `closeoutVisitId`). Header `X-Client: app` marks the event source `app`. Invalid transition → 409 `callbacks.invalidTransition`, already closed → 409 `callbacks.alreadyClosed`.
- `GET callbacks?status&open=true|false&from&to&elevatorId&buildingId&assignedUserId&cursor&limit` (keyset `receivedAt|id`, newest first), `GET callbacks/:id` (`CallbackDetailDto` with `events[]`), `GET elevators/:id/callbacks`.

Defects (any role records; PATCH is owner/office)
- `GET defects/catalog` → `{ items: [{code, label, stopLift, ref}] }` in the user's locale.
- `POST defects { elevatorId, catalogCode?, description?, severity, stopLift?, recordedAt?, sourceType, sourceId?, notes? }` → 201 `DefectDto` (catalogue code fills description + stopLift; free text needs a description).
- `PATCH defects/:id { status?, description?, severity?, notes?, noticeSentAt?, customerRequestedAt?, resolvedAt?, resolvedVisitId? }` — the transition stamps the date when not given; resolved is terminal (409 `defects.alreadyResolved`).
- `GET defects?status&open&elevatorId&buildingId&stopLift&followUpDue=true&to&cursor&limit`, `GET defects/:id`, `GET elevators/:id/defects`.

Calendar
- `POST inspections { elevatorId, kind, requestedAt?, scheduledAt?, performedAt?, result, inspectionBody?, nextDueAt?, notes?, defects[] }` (owner/office; performed + pending → 400 `calendar.resultRequired`), `PATCH inspections/:id`, `GET inspections?elevatorId&buildingId&result&from&to&cursor&limit`, `GET inspections/:id`, `GET elevators/:id/inspections`.
- `POST elevators/:id/alarm-tests { testedAt?, ok, notes? }` (any role), `GET elevators/:id/alarm-tests`.
- `GET calendar?from&to&kinds=a,b&includeOverdue` → `CalendarDto { today, from, to, items[{id, kind, refType, refId, elevatorId, elevatorInternalNo, buildingId, buildingAddressText, dueAt, inDays, severity overdue|due|upcoming, title}], counts }`. Default window today + 30 days, overdue items always included unless `includeOverdue=false`.

Registry / tenancy
- `POST elevators/:id/rotate-token` (owner/office) → `ElevatorDetailDto` with the new `publicToken` / `publicUrl`.
- `PATCH tenant { features: { publicQrPage?, publicFaultReport? }, settings: {…} }` — partial objects merge (see §6).

Outside `/api` (HTML): `/print/…` (cookie or bearer; GET only, no CSRF header; 401 page when signed out, 403 for technicians on the notice/letter), `/p/:token`, `/p/:token/report` (form-encoded).

## 4. Schema (`prisma/migrations/20260908020000_callbacks_defects_calendar_public`)

- `elevator`: `+ publicToken text UNIQUE` (backfilled with `md5(gen_random_uuid() || gen_random_uuid() || id)` for existing rows, then NOT NULL), `+ stoppedAt timestamptz`, `+ stopReason text`.
- `callback` (id, tenantId, elevatorId FK, buildingId FK, channel, callerName?, callerPhone?, classification, trappedCount?, description, status, receivedAt, dispatchedAt?, onSiteAt?, releasedAt?, restoredAt?, closedAt?, assignedUserId?, cause?, actionTaken?, chargeable, chargeReason?, notes?, slaMinutes, closeoutVisitId?, source, createdByUserId?, createdAt, updatedAt); indexes `(tenantId, status, receivedAt desc)`, `(tenantId, elevatorId, receivedAt desc)`, `(tenantId, receivedAt desc)`, `(tenantId, assignedUserId, status)`.
- `callback_event` (id, tenantId, callbackId FK cascade, type, at, receivedAt, source, byUserId?, data jsonb); index `(tenantId, callbackId, at)`.
- `defect` (id, tenantId, elevatorId FK, buildingId FK, catalogCode?, description, severity, stopLift, status, recordedAt, sourceType, sourceId?, noticeSentAt?, customerRequestedAt?, followUpDueAt date, resolvedAt?, resolvedVisitId?, notes?, createdByUserId?, createdAt, updatedAt); indexes `(tenantId, status, followUpDueAt)`, `(tenantId, elevatorId, recordedAt desc)`, `(tenantId, recordedAt desc)`.
- `inspection` (id, tenantId, elevatorId FK, kind, requestedAt?, scheduledAt?, performedAt?, result, inspectionBody?, nextDueAt?, notes?, defects jsonb, createdByUserId?, createdAt, updatedAt); indexes `(tenantId, elevatorId, performedAt desc)`, `(tenantId, nextDueAt)`, `(tenantId, scheduledAt)`.
- `alarm_device_test` (id, tenantId, elevatorId FK, testedAt, ok, notes?, byUserId?, createdAt); index `(tenantId, elevatorId, testedAt desc)`.
- New Postgres enums: `CallbackChannel`, `CallbackClassification`, `CallbackStatus`, `EventSource`, `ChargeReason`, `DefectStatus`, `DefectSource`, `DefectSeverity`, `InspectionKind`, `InspectionResult`.
- Ownership map (`platform/db/ownership.ts`) and the tenant guard cover every new model; `test/helpers.ts` truncates them.

**Migration rename.** The step-2 folder `20260907220820_visits_billing_due` sorted *before* `20260908000000_init`, so `prisma migrate dev` could not replay the history into its shadow database (P3006). It is now `20260908010000_visits_billing_due`; the `_prisma_migrations.migration_name` rows of the local `avroleva` and `avroleva_test` databases were updated by hand. **Any other database that already applied the old name needs the same one-line `UPDATE` before `prisma migrate deploy`** (the VPS has never been migrated, so nothing to do there).

## 5. Rules and conventions kept

- Same-layer modules never import each other: `callbacks` → `visits` goes through the `VisitRecorder` port; the cross-module calendar merge lives in `reporting` (L4); `defects`/`calendar` call the registry (L2) through commands on its `index.ts`; the public facade resolves the tenant from the token with the one documented unscoped read (`registry/repo/elevators.findByPublicToken`).
- Every timestamp on the callback timeline stores `at` + `receivedAt` + `source` (A13); the row is a projection of its events.
- Evidence rules (A12): a technician may go on site before being dispatched (he is assigned on the fly) and a callback may be closed without a visit (`createVisit: false`) — the record shows what happened.
- New events: `CallbackOpened/Dispatched/OnSite/Released/Restored/Closed`, `DefectRecorded`, `StopLiftRequired`, `DefectResolved`, `InspectionRecorded`, `AlarmDeviceTested` (logged in `subscribers.ts`; notifications attach there in step 5).
- i18n: 271 new keys in `bg.json` + `en.json`; server-side pages and calendar titles use the tenant locale.

## 6. Bug found on the way: zod 4 `.partial()` keeps defaults

`z.object({ status: ElevatorStatus.default('active') }).partial().parse({})` returns `{ status: 'active' }` in zod 4. Every `update*Body = create*Body.partial()` (customers, buildings, elevators, contracts, visit amend, tenant settings) therefore silently reset defaulted fields on PATCH — e.g. `PATCH /elevators/:id { notes }` would have set `status = 'active'`, and `PATCH /tenant { settings: { alarmTestIntervalMonths: 6 } }` would have reset every other setting. The office forms happened to send every field, which hid it. `contracts/common.ts: patchOf()` strips the defaults before making the fields optional; every PATCH schema now uses it. Covered by the step-3 integration tests (tenant features/settings merge, inspection PATCH).

## 7. Tests

`npm test`: i18n (12); API unit 59 (`step3.test.ts`: SLA states and transitions, follow-up date across the Sofia midnight, catalogue shape, inspection next-due incl. month-end clamping, severity offsets, token entropy over 1000 samples, feature-flag defaults) + integration 62 (`step3.test.ts` 26: full callback flow office → technician → close-out visit, technician visibility, idempotent client id, list filters and cursors, tenant isolation for every route; stop-lift defect stops and resolving restores the elevator, two stop-lift defects, PATCH role rules; inspections first/second interval, explicit next date, failed/pending, scheduled, alarm tests; the merged calendar with all five kinds and the dashboard counts; public page 404 → flag → 200, form → callback, honeypot, 5/h limit, token rotation; printable pages incl. 401/403/404). All 121 green; `npm run lint` and `npm run build` green.

## 8. Known gaps (by design in step 3)

- No scheduler yet: `CallbackSlaAtRisk/Breached` are not emitted, the calendar is computed on read (no `calendar_item` table), the defect follow-up is a list, not a reminder. pg-boss lands with notifications (step 5).
- Printable pages are HTML only (browser print → PDF); no `document` rows / dossier, no Chromium. The notice has no "mark sent" button on the page itself (CSP forbids inline handlers) — the office marks it from the defect row.
- The public page shows the last visit date and the next inspection month; no photos, no history. Rate limits are in-memory (per process).
- Callbacks: no monthly response-time report per building yet (the data is there: `responseMinutes` per closed callback); no `partsUsed`; a callback that was closed by phone has `responseMinutes = null` and is judged by `closedAt`.
- Defects from a visit checklist (`sourceType = visit` with a `sourceId`) are recorded only through the API; the office form records `sourceType = office`.
- Inspection findings (`defects` JSONB) are not linked to `defect` rows (ARCHITECTURE's `inspection_defect`); the office edits them inline.
- `elevator.nextInspectionAt` can still be edited by hand on the elevator form; the next performed inspection overwrites it.
- Technician role in the office UI sees the callbacks/defects/calendar pages read-mostly; the dispatch picker is hidden for him.

## 9. What step 4 (offline technician PWA) needs from the API

Already there: `POST /visits` idempotent on a client UUID with `source=app`; `POST /callbacks` idempotent on `id`; `X-Client: app` provenance on callback transitions; `POST /defects` and `POST /elevators/:id/alarm-tests` for technicians; `GET /defects/catalog`; session `kind=device` (180 days) in the model; `Authorization: Bearer` on every route.

To add (ARCHITECTURE §4 / §5):
1. **Device enrollment**: table `device_enrollment_token` (tenantId, userId, codeHash, expiresAt 10 min, usedAt) + `POST /auth/enroll/start` (owner screen, returns a QR payload) and `POST /auth/enroll/complete { code, deviceName, clientVersion }` → device session token. `POST /auth/sessions/:id/revoke` ("излез от този телефон").
2. **Sync pull**: `GET /sync/pull?since=<ISO>` → `{ serverTime, buildings[], elevators[], contacts[] (house-manager phones only), callbacks[] (open + assigned), defects[] (open), defectCatalog, checklistTemplates[], settings }` with `updatedAt >= since − 2 s` and soft-delete tombstones. Every registry row already has `updatedAt`; callbacks/defects/inspections too.
3. **Sync push**: `POST /sync/push` with a batch of outbox items `{ id, kind: visit.record | visit.amend | callback.open | callback.event | defect.record | alarm.test, schemaVersion, payload, at, clientOffsetMs }`, processed strictly in order, each under **`Idempotency-Key = item id`** → new table `idempotency_key (tenantId, key, requestHash, responseStatus, responseBody, createdAt)` (7-day TTL) and a platform middleware that replays stored responses (same key + different body → 422). `callback.event` maps onto the existing transition endpoints with `at` from the device and `source = app`.
4. **Clock skew**: return `serverTime` on pull/push; accept `clientOffsetMs` on every evidence timestamp and flag `clockAdjusted` / `clockSuspect` on the visit (`qualityFlags` already exists) and on callback events (`data`).
5. **Attachments**: `POST /attachments` (multipart, sha256, `clientId`), `documents` module tables `attachment`, `visit_attachment`; visits get `attachmentIds[]` before the photos land.
6. **Checklist snapshot** on the visit (`checklistTemplateId`, `checklistVersion`, `checklist` JSONB) and the `checklist_template` table with the seeded functional-check template in `packages/domain-data/checklists/`.
7. `X-Min-Client-Version` response header (config value) for the forced-update flow.
