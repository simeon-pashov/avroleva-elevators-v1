# Avroleva — Handoff after step 2 (dashboard)

Date: 2026-09-08. Read `ARCHITECTURE.md`, `MVP-PLAN.md` and `HANDOFF-STEP1.md` first; this file says what step 2 added, how it is wired, and what the next steps (callbacks, calendar/inspections, technician PWA, notifications, exports) will need from it.

## 1. What exists now

Step 1 (foundation: tenancy, registry, admin, CSV import, office SPA) is unchanged in shape. Step 2 adds:

| Area | What |
|---|---|
| `modules/maintenance` (L3) | The cycle engine as a pure function `nextDue()` + `dueState()`, the due board (`GET /maintenance/due`) and the one-off reschedule (`POST /elevators/:id/reschedule`). Owns no table yet. |
| `modules/visits` (L3) | Tables `visit`, `visit_technician`. Record (idempotent on a client id), amend (superseding row), history per elevator (keyset cursor), list by date range. Emits `VisitRecorded`, `VisitAmended`. |
| `modules/billing` (L3, light) | Tables `invoice`, `invoice_sequence`, `payment`. Period generation from contract lines, gapless per-tenant numbering, pay (partial / full), unallocated payments, summary, building / elevator views. Emits `InvoiceIssued`, `PaymentRecorded`. |
| `modules/reporting` (L4) | `GET /dashboard`: counts by due state, money, one pin per elevator — from the registry read model + billing summary, no N+1. |
| registry | `elevator.nextCheckDueAt` and `nextCheckOverrideAt` columns (denormalised, indexed), `GET /elevators/:id` returns the popup view (`ElevatorDetailDto`: contact, customer, price, dueState), commands `recordCheck` / `setCheckOverride` / `recomputeSchedule` for the L3 modules, read model `listForSchedule` (elevator + building + house-manager contact + active price in one query). |
| tenancy | `TenantSettingsChanged` event (interval / strategy change → registry recomputes every due date through `subscribers.ts`), `findUsersByIds` (technician name snapshots), settings `invoiceDueDays` (14) and `vatRatePercent` (20). |
| office | Dashboard (map with one clickable pin per elevator, elevator side panel with history + payments, due widget today/tomorrow, payments widget), elevator detail tabs. See §6. |
| seed | 6–18 months of visits per demo elevator, 6 months of invoices per contract (paid / pending / overdue mix), two unallocated payments. Idempotent. |

Module rules kept: modules import lower layers only through `index.ts`; the registry (L2) never imports maintenance (L3) — it declares a **schedule port** (`registry/domain/due.ts: ScheduleRules`) that `app.ts` (composition root) wires with `maintenance.scheduleRules`; the seed does the same. Table ownership map updated in `platform/db/ownership.ts`; the tenant guard covers every new model.

## 2. How to run (unchanged) + step-2 specifics

```bash
docker start unclecrm-db     # shared dev Postgres on localhost:5432
npm run db:migrate           # applies 20260907220820_visits_billing_due
npm run db:seed              # idempotent; recomputes due dates relative to "today"
npm run dev                  # API :3005, office :5175
npm test                     # i18n (12) + api unit (44) + api integration (33)
npm run lint && npm run build
```

Seeded logins: `demo` / `demo1234` (owner), `maria` / `demo1234` (office), `ivan` / `demo1234` (technician — sees the board, never money); platform admin `admin` / `admin12345` at `/admin/login`.

The seed re-runs safely: it shifts every elevator's `lastCheckAt` relative to today (so the demo always has overdue / today / tomorrow rows), clears any reschedule override, adds a visit only when the newest stored visit is older than the new `lastCheckAt`, and never creates a second invoice for the same contract + period.

## 3. API added (`/api/v1`, all tenant-scoped, RFC 7807 errors, cross-tenant → 404)

Maintenance
- `GET maintenance/due?date=YYYY-MM-DD` → `DueBoardDto { date, today, due[], overdue[], counts {overdue, today, tomorrow} }`; groups per building with `contact {name, phone}`; `overdue` is always relative to today, whatever `date` is. Any role.
- `POST elevators/:id/reschedule { toDate | null }` → `ElevatorDto` (owner/office). Past dates → 400 `maintenance.rescheduleInPast`.

Visits (any role may record; amend is owner/office)
- `POST visits { id?, elevatorId, kind, startedAt, endedAt?, technicians[{userId? | name?}], notes?, source }` → 201 `VisitDto`. Same `id` again → the stored visit (idempotent). `functional_check` / `technical_maintenance` move `elevator.lastCheckAt` (never backwards), clear the override, recompute `nextCheckDueAt` — same transaction. Future `startedAt` → 400 `visits.inFuture`. `qualityFlags`: `singleTechnician`, `endBeforeStart`.
- `POST visits/:id/amend {…}` → 201 new visit with `supersedesVisitId`; the original gets `supersededAt` (never edited). 409 `visits.alreadySuperseded`.
- `GET visits/:id`, `GET visits?from&to&elevatorId&buildingId&kind&cursor&limit`, `GET elevators/:id/visits?cursor&limit` (newest first, cursor = `startedAt|id`).

Billing (owner/office only; technicians get 403)
- `POST billing/invoices/generate { period: YYYY-MM }` → `{ created, skipped, invoices[] }`. One invoice per active contract whose lines are in force that month; idempotent per (contract, period); numbers from `invoice_sequence` under `SELECT … FOR UPDATE` in one transaction for the batch (a failed batch consumes nothing — tested). `dueAt` = contract `paymentDay` in that month, else `issuedAt + settings.invoiceDueDays`. VAT = `settings.vatRatePercent`, rounded once per invoice.
- `GET billing/invoices?status|pending=true&buildingId&customerId&month&cursor&limit`, `GET billing/invoices/:id`.
- `POST billing/invoices/:id/pay { paidAt, method, amountCents?, note? }` → partial keeps it open, full → `paid` + `paidAt`. 409 `billing.invoiceNotOpen`, 400 `billing.paymentExceedsOpen`.
- `POST billing/payments { buildingId, invoiceId?, amountCents, paidAt, method, note? }` (unallocated when no invoice), `GET billing/payments?buildingId&month`.
- `GET billing/summary?month` → `{ pendingCents, pendingCount, overdueCents, overdueCount, paidThisMonthCents, paidThisMonthCount }`.
- `GET buildings/:id/billing`, `GET elevators/:id/billing` (adds `elevatorAmountCents` per invoice = that elevator's line).

Status roll `issued → overdue` (dueAt < today) runs at the start of every billing read (`billing.rollStatuses`) — there is no scheduler yet; the same function becomes the nightly pg-boss job later and will then emit `InvoiceOverdue`.

Reporting
- `GET dashboard` → `DashboardDto { today, counts {elevators, overdue, today, tomorrow, soon, ok, stopped, none, buildingsOnMap, buildingsWithoutCoordinates}, money {…}, pins[{elevatorId, buildingId, lat, lng, label, addressText, internalNo, status, state, nextCheckDueAt}] }`. Two queries.

Registry changes
- `ElevatorDto` gains `nextCheckDue` (from the stored column), `nextCheckOverrideAt`, `dueState`. `GET elevators/:id` returns `ElevatorDetailDto` (+ `buildingAddressText`, `buildingEntrance`, `customerId/Name`, `contact`, `contractId`, `monthlyPriceCents`).
- Editing `lastCheckAt` by hand through `PATCH elevators/:id` clears a pending override (a correction supersedes a reschedule).

## 4. Schema changes (`prisma/migrations/20260907220820_visits_billing_due`)

- `elevator`: `+ nextCheckDueAt date`, `+ nextCheckOverrideAt date`, index `(tenantId, nextCheckDueAt)`.
- `visit` (id, tenantId, elevatorId FK, buildingId FK, kind enum `VisitKind`, startedAt, endedAt?, notes?, source enum `VisitSource`, qualityFlags jsonb, createdByUserId?, supersedesVisitId?, supersededAt?, createdAt); indexes `(tenantId, elevatorId, startedAt desc)`, `(tenantId, startedAt desc)`, `(tenantId, buildingId)`.
- `visit_technician` (id, tenantId, visitId FK cascade, userId?, position, name snapshot).
- `invoice_sequence` (tenantId PK, nextNumber).
- `invoice` (id, tenantId, contractId — plain id, buildingId FK, customerId — plain id, number, periodStart/End, issuedAt, dueAt, amountCents, vatCents, totalCents, paidCents, currency, status enum `InvoiceStatus`, lines jsonb, paidAt?, voidedAt?, voidReason?); unique `(tenantId, number)`, unique `(tenantId, contractId, periodStart)`.
- `payment` (id, tenantId, invoiceId? FK, buildingId FK, amountCents, paidAt, method enum `PaymentMethod`, note?, createdByUserId?).

Cross-module references stay plain ids (contractId, customerId, createdByUserId, supersedesVisitId); FKs only to identity tables (tenant, building, elevator) per ARCHITECTURE §1.1 rule 4.

## 5. Cycle engine semantics (`maintenance/domain/nextDue.ts`, unit-tested)

- `rolling`: `lastCheckAt + intervalDays` (elevator interval, else tenant default).
- `calendar_month`: last day of the month `floor(interval/30)` months (min 1) after the month of `lastCheckAt`; intervals < 28 days fall back to rolling.
- `nextCheckOverrideAt` always wins ("Премести за утре"); cleared by the next check visit or a manual `lastCheckAt` edit.
- Never checked → `null` → state `none` (not on the board; the import already warns about a missing last check).
- Date-only arithmetic in UTC: DST changes in Europe/Sofia never shift a due day; "today" comes from the Sofia wall clock (`todayInSofia`, `dateOnlyInSofia`).
- `dueState`: stopped statuses → `stopped`; out_of_contract / scrapped / no date → `none`; else overdue / today / soon (≤ 7 days) / ok.

## 6. Office (apps/office)

Dashboard `/`: Leaflet map (tiles from `VITE_MAP_TILES_URL`) with one pin per elevator coloured by `dueState`, pins of one building spread around its point, popup with "Отвори", bounds fitted on first load and the viewport remembered in `localStorage['avroleva.dashboard.map']`; `ElevatorPanel` drawer (identity, домоуправител tel: link, customer, price, dates, tabs "История на поддръжката" / "Плащания", "Отбележи посещение", "Към асансьора"); `DueWidget` (Днес / Утре toggle, overdue group flagged, per-row "Отбележи посещение" / "Премести за утре" / "Отвори"); `PaymentsWidget` (Чакащи / История, building + month filters, totals, "Отбележи като платено"). The elevator detail page carries the same history / payments tabs. Money widgets are hidden for technicians. Screenshot: `docs/screenshots/dashboard.png`.

## 7. Tests

`npm test`: i18n completeness (12), API unit (44: validation, session, password, import, tenant guard, **nextDue** incl. month ends / DST / overrides / calendar strategy, **invoiceForPeriod**), API integration (`api.test.ts` 20 + `step2.test.ts` 13 + `auth-concurrency.test.ts` 3: due board, reschedule, settings-change recompute through the event bus, visit idempotency / lastCheckAt rules / cursor / amend, invoice generation idempotency, **gapless numbering under a rolled-back transaction**, pay partial + full, summary, building / elevator views, technician 403s, dashboard, tenant isolation for every new route incl. non-uuid ids).

## 8. Known gaps (by design in step 2)

- **Transient `GET /auth/me → 500` seen once during a full page reload.** Investigated: the sliding-expiry write (`touchSession`) runs once per request on an aged session, so a reload fires a burst of concurrent updates on one row. `test/integration/auth-concurrency.test.ts` reproduces that burst (30 parallel `/auth/me`, mixed cookie + bearer reads and writes, a logout racing 15 reads) and every request answers < 500 — Postgres serialises the row updates. The likely source of the one-off is the Vite dev proxy (`/api → :3005`) answering 500 while `tsx watch` restarted the API after a file save. Hardened anyway: `touchSession` is now `updateMany` guarded by `revokedAt IS NULL` (no P2025 if a logout wins the race) and wrapped in try/catch — the renewal is best-effort and can never fail an already-authenticated request.

- No scheduler: overdue status roll is on-read; no `InvoiceOverdue` / `JobOverdue` events yet.
- No `maintenance_job` table: the board is computed from `elevator.nextCheckDueAt`; assignment to technician pairs / routes is not modelled.
- Billing is "light": no invoice PDF, no supplier/recipient snapshots, no void/credit note endpoint (columns exist), no external invoicing push, no pro-rating of a line that starts/ends mid-month.
- `GET billing/invoices` looks up customer names with one registry query per distinct contract (fine at MVP sizes; make it a join or denormalise `customerName` on the invoice when lists grow).
- Visits carry no checklist / photos / signatures (documents module) and no GPS; `source=app` is reserved for the PWA.
- Pins for elevators whose building has no coordinates are not shown (the dashboard counts them: `buildingsWithoutCoordinates`).
- No `Idempotency-Key` header support yet (visits use a client-provided `id` instead).

## 9. What the next steps need from here

- **Callbacks (авария)**: new L3 module with `callback`, `callback_event`; the close-out visit is a `POST /visits` with `kind=callback` (already accepted) — add a `VisitRecorder` port in callbacks rather than importing visits; the SLA timer needs the scheduler (pg-boss) that billing's status roll is also waiting for. The elevator popup already has a place for "open callbacks" (add to `ElevatorDetailDto`).
- **Calendar / inspections**: `elevator.nextInspectionAt` exists and is shown; the calendar module should own `inspection` and recompute `nextInspectionAt` through a registry command like `recordCheck`. Use the same schedule-port pattern if inspection intervals become tenant settings.
- **Technician PWA**: `POST /visits` is already idempotent on a client UUID and accepts `source=app`; device sessions (`session.kind=device`, 180 d) exist in the model. Needed: `device_enrollment_token`, `/sync` facade batching visits, attachments (documents module), and the checklist snapshot on the visit.
- **Notifications**: subscribe in `subscribers.ts` to `VisitRecorded`, `InvoiceIssued`, `PaymentRecorded` and the future `InvoiceOverdue` / `JobOverdue`; the house-manager contact (phone, viber flag, email) is already on the building.
- **Exports / delete-my-data**: every new table has `tenantId` first; add `visit`, `visit_technician`, `invoice`, `payment` to the CSV export list and to the tenant purge script (`deleteTenantData`) in that order (payments → invoices → invoice_sequence; visit_technician → visit).
- **Docker / VPS**: unchanged sketches from step 1; the new migration must run with `prisma migrate deploy` before the seed.
