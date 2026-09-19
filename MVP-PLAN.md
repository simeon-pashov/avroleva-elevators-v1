# Avroleva Elevators — MVP Build Plan

Date: 2026-09-07. Companion to `ARCHITECTURE.md` (module names, tables and mechanisms referenced here are defined there). Effort is in working days for one developer with Claude Code, assuming ~6 focused hours/day; ranges are honest, not padded. Total for phases 0–9: **53–70 days** (≈ 3–3.5 months full-time), with the founding customer live after phase 6 and phases 7–9 delivered while they use it.

Order of principles when phases collide: (1) evidence capture never blocks, (2) nothing the customer entered is ever lost, (3) every phase ends deployed on the VPS with the demo tenant, (4) no phase adds a dependency the previous phase did not need.

---

## 1. Phases

| # | Phase | Days | Depends on |
|---|---|---|---|
| 0 | Scaffold, platform, seeds, deploy pipeline | 6–8 | — |
| 1 | Register + CSV import + map + QR labels | 6–8 | 0 |
| 2 | 30-day cycle engine + due board + assignment | 4–5 | 1 |
| 3 | Offline technician PWA + checklist + photos + дневник page | 12–15 | 2 |
| 4 | Callback flow + defect catalogue + notice to the building | 6–8 | 3 |
| 5 | Calendar: inspection dates, alerts, inspection-request letter, дневник dossier | 4–6 | 1, 4 |
| 6 | Light money: invoices, payments, arrears, unpaid flag | 6–8 | 1 |
| 7 | Notifications: e-mail, SMS, Viber links, rules | 4–5 | 4, 6 |
| 8 | Monthly PDF per building | 2–3 | 3, 4, 6 |
| 9 | Dashboard + exports polish | 3–4 | all |

### Phase 0 — scaffold, platform, seeds, deploy (6–8 days)

**Scope.** npm-workspaces monorepo (`apps/api`, `apps/office`, `apps/tech`, `packages/contracts|domain-data|i18n`); TypeScript 5 strict, ESLint 9, Prettier, Vitest 4; Prisma 6 schema with the `tenancy`, `registry`, `documents` and platform tables (architecture §3) and empty skeletons of every other module (`index.ts` with typed no-op commands, router, events) so the boundaries exist before the code; `dependency-cruiser` + `check-boundaries.ts` in CI; platform: config loader (zod, fail-fast), Prisma extension asserting `tenantId`, `domain_event` outbox + dispatcher on pg-boss 10, ports with `console`/`local`/`memory` adapters (SMS, e-mail, Viber, storage, geocoder, PDF, invoicing), `audit_log` with hash chain and INSERT-only grants, i18n scaffold (`bg.json` source of truth, `t()` on server and clients, Europe/Sofia date helpers); auth (cookie + bearer sessions, bcrypt, roles, device enrollment QR, rate limits, CSRF header); `/api/v1/health`; **PDF pipeline proof**: a Handlebars template with Cyrillic text rendered through Chromium inside the Docker image on the VPS, Noto Sans embedded, verified with `pdf-parse`; office and tech app shells (login, layout, language switch, PWA manifest + service worker, "offline" indicator); Docker multi-stage image, `docker-compose.yml` (dev) and `docker-compose.prod.yml` (VPS, port 3005), nginx snippet, `scripts/deploy.sh` (backup → pull → build → migrate → health), `scripts/backup.sh` + restic offsite, GitHub Actions `ci.yml`; **seeds from the ordinance**: `checklists/functional-check.v1.json` (every item of Приложение към чл. 9 ал. 1 т. 2 in its groups — panels and lighting, semi-automatic doors, automatic doors, goods-only lifts, stop button/hatch/apron, machine room incl. the full-length rope check, hydraulic unit, control panel — each with `appliesTo` by drive/door type), `defects/art10.v1.json` (the 17 items, `stopLift: true`, legal reference), `calendar-rules.json`; demo tenant seed; tenant-isolation harness with two tenants.

**Out of scope.** Any feature screen; Capacitor; S3; Viber Business.

**Outcome.** `https://srv…/avroleva/elevators-v1/` shows a login; the demo owner sees an empty register; a technician enrolls a phone by QR; health is green; a Cyrillic PDF downloads.

**Acceptance.** Owner logs in on desktop and the technician on a phone (home-screen install works on Android Chrome and iOS Safari). Deploy from a clean clone to the VPS is one command. CI green on `main`. `SEED_DEMO=true` creates the demo tenant idempotently. The isolation test fails when a route is added without a tenant guard (proved by adding one on purpose).

### Phase 1 — register, CSV import, map, QR labels (6–8 days)

**Scope.** `registry` module fully: customers (ползватели) with contacts, buildings with structured address and access notes (encrypted), elevators with the full identity block (registration number, inspection body, regional supervision office derived from област as reference data, type, stops, hydraulic flag, doors, alarm device/SIM, retrofit status, status), contracts with elevator price rows and history; CSV import (template download, upload → preview with per-row errors → commit → rollback of the batch); geocoding job (Nominatim, 1 req/s) with "pin manually" fallback in the office map (Leaflet); QR `publicCode` per elevator, label sheet PDF (A4, 24 labels), public page `/q/<code>` (address, last/next check month, emergency phone, fault form behind a feature flag — the form itself lands in phase 4); CSV export of every registry dataset; archive (soft delete) with preview + confirm; audit of every change.

**Out of scope.** Jobs, visits, money, notifications.

**Outcome.** The owner sees their whole portfolio as a list and as pins on a map within an hour of handing over their Excel.

**Acceptance.** Owner can: download the template, import 200 rows with 5 deliberate errors and get a readable error list, fix and re-import, see 200 elevators on the map with ≤ 10 needing a manual pin, open an elevator and see registration number, inspection body and regional office, terminate a contract and see the elevator go `outOfContract` with history kept, export elevators to a CSV that opens in Excel with Cyrillic intact, print a QR sheet, scan a label and see the public page. A second tenant cannot open the first tenant's elevator by id (404).

### Phase 2 — 30-day cycle engine, due board, assignment (4–5 days)

**Scope.** `maintenance` module: nightly + event-driven job generation (`nextDue = lastCheckAt + interval`, per-elevator interval, tenant default 30, strategy `rolling` now with `calendarMonth` behind a flag), due board (today / this week / overdue in red, per building), assignment to technician pairs (routes as ordered building lists), manual "done on paper" close-out from the office (source = paper) so the board is truthful before phase 3; `lastCheckAt/nextCheckDue` denormalised on the elevator; JobOverdue events.

**Out of scope.** Route optimisation; calendar UI beyond a list.

**Outcome.** Every in-contract elevator has exactly one open functional-check job; the owner sees who is late.

**Acceptance.** Owner can set an elevator to a 15-day interval and see its job move; import a portfolio and get one job per elevator; assign a route to Иван + Петър; mark a job done from a paper entry with a date; run the generator twice with no duplicates (unit + integration tests). Contract termination cancels open jobs.

### Phase 3 — offline technician PWA, checklist, photos, дневник page (12–15 days)

**Scope.** `apps/tech` offline-first as in architecture §4: Dexie store, pull/push sync, outbox with idempotency keys, background retry; today's list by route with access notes and last-visit summary; visit form: elevator (from job or QR scan), checklist from the tenant's template version with ok / defect / n.a. per item, remarks, photos (camera, downscaled; a photo of the signed дневник page recommended), two technician names (second picked from the list; a single name is allowed with a data-quality flag), timestamps with provenance, optional GPS (flag, off by default); `visits` module: idempotent `recordVisit`, supplement rule, amendments, DefectRecorder port into `defects` (minimal row; catalogue UI in phase 4); office visit history per elevator with photos; **дневник page PDF** (template v1 mirroring the book columns, A5 and A4, record hash); office "enter from paper" form (`officeVisitEntry`) for firms whose technicians refuse the phone; clock-skew handling with `clockAdjusted`/`clockSuspect` flags; `X-Min-Client-Version` update flow.

**Out of scope.** Capacitor build; customer signature (flagged, later); parts.

**Outcome.** A technician records a visit in a basement with no signal in about 20 seconds; the office sees it, with photos, when the phone reaches the street.

**Acceptance.** Technician can: install to the home screen, log in via the QR on the owner's screen, open today's list, record a visit in airplane mode with 3 photos and two names, record another on a second elevator, turn data on and watch both sync with photos; kill the app mid-upload and see it complete later; see a "new version" prompt after a deploy. Owner can: open the visit with checklist results and photos, print the дневник page and compare it with the book, see the flag when only one technician was named, see both submissions when two technicians submitted the same job, export visits to CSV. The Playwright offline smoke passes.

### Phase 4 — callback flow, defect catalogue, notice to the building (6–8 days)

**Scope.** `callbacks` module: intake from office (phone), technician phone (call came directly), public QR fault form (rate-limited, feature flag); classification (заседнал човек / повреда / оплакване), trapped count, injuries; dispatch to technician(s); timeline events on the phone (on site, released, restored, left out of service) with provenance; response-time countdown on office and phone (default 60 min, configurable per tenant), `slaWatch` job raising `CallbackSlaAtRisk` at 75 % of the limit and `Breached` at 100 %; close-out with cause, action, parts, chargeable flag + reason, optional close-out visit; per-building callback history and monthly response-time numbers. `defects` module fully: the 17-item seeded catalogue picker with "спри асансьора + писмено уведомление" auto-set, free-text defects, written notice PDF to the ползвател (the building), "user requested repair" tick, an office to-do "открит дефект над N дни без одобрение от ползвателя" (N per tenant, default 30) on the calendar, resolution from a visit; elevator status `stoppedByFirm` with restart record.

**Out of scope.** Telephony/GSM-module integration; repair quotes (a `repair` visit kind exists; quote → approval → invoice tracking is v1.1).

**Outcome.** Every emergency has a timestamped record that shows the firm's response time was met — or was not, honestly.

**Acceptance.** Office can: open a callback from a phone call in three taps, dispatch to Иван, watch the countdown, see it close from the phone with times and cause, mark it chargeable. Technician can: open a callback himself when the cabin device rang his mobile, mark on-site/released offline, pick "т. 17 неработеща гласова връзка" and see the stop-lift notice generated. Owner can: see open defects and the follow-up list at day 25+, print the notice to the building, see the elevator marked stopped with the date. The monthly response-time report per building matches a hand count.

### Phase 5 — calendar: inspection dates, alerts, inspection-request letter, дневник dossier (4–6 days)

**Scope.** `calendar` module: inspections per elevator (kind, body, request letter PDF to the building, scheduled/performed, result, ревизионен акт upload, defects with deadlines, next due, sticker year); nightly `calendar_item` materialisation (inspection due 90/60/30/7 — offsets configurable, check overdue, defect follow-up, alarm-device test due, hydraulic protocol due, contract ending, missing registration number, missing alarm device); calendar screen "Срокове" (by due date, filter by kind) and per-elevator deadlines card; alarm-device test log and hydraulic-fluid protocol log; dossier view per elevator (documents by kind, retention date, upload of drawings/declarations/quality documents/акт/payment documents).

**Out of scope.** Sending letters automatically (phase 7 adds e-mail); anything addressed to the regulator (see the backlog below).

**Outcome.** The owner never misses an inspection date again and has every elevator's documents in one place.

**Acceptance.** Owner can: see every elevator with an inspection due in 90 days, record an inspection with a photo of the акт and two defects with deadlines, see the next due date roll forward 12 months, print the inspection-request letter for a building, upload a declaration of conformity and see it in the dossier with its retention date, log an alarm-device test.

### Phase 6 — light money (6–8 days)

**Scope.** `billing` module: monthly draft invoices per building from contract prices (period, lines per elevator), issue with gapless per-tenant numbering, supplier/recipient snapshots, EUR with optional BGN reference line, VAT 20 % or the not-registered regime with the чл. 113 ал. 9 text, PDF per invoice (e-mail in phase 7); payments (bank/cash with fiscal receipt number), partial payments, void via credit note; arrears per building with ageing (30/60/90); **unpaid flag** on the building shown on dispatch and on the technician's job list; `InvoicingProvider` port with the internal adapter, inv.bg adapter stubbed behind a flag until a customer uses inv.bg. `pricing` module: plan rows, subscription state machine (trialing 90 days → active → pastDue → readOnly), monthly usage snapshot, admin page; charging the firm stays manual.

**Out of scope.** Accounting, bank reconciliation, fiscal devices, online payment by buildings, dunning automation (phase 7 sends reminders on request).

**Outcome.** The office produces the month's invoices in minutes and sees who owes what before sending a technician.

**Acceptance.** Office can: generate December drafts for all buildings, edit one, issue all, download PDFs whose fields match the accountant's sample, record a cash payment with a receipt number, see building X at 90 days overdue and the red "неплатено" badge when dispatching to X, issue a credit note that voids an invoice with numbering still gapless, export invoices and payments to CSV. Platform admin can set a tenant's plan and see the charge at 101 elevators equal two blocks.

### Phase 7 — notifications (4–5 days)

**Scope.** `notifications` module: templates (BG defaults for visit done, callback dispatched/closed, invoice issued/overdue reminder, inspection due, inspection-request cover e-mail to the building), rules per tenant (event → channel → recipient), e-mail via SMTP, SMS via a provider adapter, Viber deep-link flow (office: one click copies the text and opens the chat; logged), delivery log with status and retries, opt-out per contact.

**Out of scope.** Viber Business sender (flag, ~€150/month, at ~10 firms); WhatsApp (adapter slot exists).

**Acceptance.** Owner can enable "домоуправителят получава SMS при приключено посещение" and the contact receives it within a minute; the log shows sent/failed; an overdue reminder can be sent to all buildings > 60 days with one click; e-mailing an inspection-request letter to a building records it in the delivery log.

### Phase 8 — monthly PDF per building (2–3 days)

**Scope.** `reporting.monthlyBuildingReport`: for a building and month — visits with dates and technicians, callbacks with response times, open defects, inspection status, invoice status; PDF with photos thumbnails optional; generated in bulk at month end (job) and per building on demand; e-mail/Viber send via phase 7.

**Acceptance.** Owner can generate "Какво направихме за вашите асансьори през ноември" for all buildings in one click and send one to a домоуправител.

### Phase 9 — dashboard and exports polish (3–4 days)

**Scope.** Dashboard: overdue checks (просрочени), open callbacks with timers, defects awaiting follow-up, inspections due 30 days, unpaid > 60 days, contracts ending 90 days; KPIs per month (visits on schedule %, callbacks per 100 elevators, % within the response-time limit); full tenant export zip (all CSVs + documents + audit chain); "delete my data" (`deleteTenantData`) in the owner settings with the 30-day grace; `/admin/system` page.

**Acceptance.** Every number on the dashboard links to the list that produced it; the full export restores into a spreadsheet the founder can explain in five minutes; the delete request shows its cancel-until date and writes an audit entry.

### Backlog — regulator-facing (deliberately excluded from MVP)

Product stance: we track the business; regulator interaction is the firm's own job. Each item below was in the original plan and is parked, not lost; the event model and the export keep the data available if a paying customer asks (architecture D21).

- Quarterly letter to the regional ДАМТН offices (чл. 9 ал. 5): `generateQuarterlyLetter`, `regulatory_filing` table, `markFiled`, `FilingDue`, the "quarterly letter" document template, the "quarter-end ДАМТН list" sales hook — product stance: we track the business; regulator interaction is the firm's own job.
- `RegulatorFiling` port and any e-filing adapter — same reason; the risks table keeps one sentence on how the event model would allow an adapter later.
- Authority notification on defects (`notifyAuthority`, чл. 10 ал. 2) and the 30-day escalation to ДАМТН (`escalate`, `EscalationDue`, `DefectEscalated`, escalation letter template, чл. 9 ал. 8) — same reason; what stays is the neutral office to-do "defect open > N days without the building's go-ahead".
- Firm's own annual ДАМТН check window reminder (`firm_compliance`, `FirmCheckWindowOpen`) — same reason; backlog as an optional private reminder.
- Post-repair document pack to the inspection body (чл. 9 ал. 7) — same reason.
- Any UI copy, notification template or dashboard tile naming ДАМТН, закон, наредба, compliance or regulator — same reason; the user-facing vocabulary is график, просрочени, история, срокове, технически преглед, дневник, авария.

---

## 2. "Demo-able to a firm in 2 weeks"

The demo is one story told on the founder's laptop and a phone: *"Дайте ми вашия Excel → ето всичките ви асансьори на картата → ето кой е закъснял този месец → техникът натиска три пъти в мазето → ето страницата за дневника и снимката."*

**Built (10 working days):** phase 0 minimal (skip `deploy.yml`, restic, Sentry, the tech app's update flow and the isolation harness beyond the basic test), phase 1 core (register, import, map, QR PNG instead of the label sheet), phase 2 core (generator + due board, no routes), and a **phase 3 demo slice**: the technician screen works online only (no Dexie/outbox yet), records a visit with the seeded checklist v1, one photo and two names, and the дневник page renders from template v1.

**Faked or skipped, and said so on the call:** offline (say "works without signal in the real version, this is the connected demo"), callbacks (a mock screen with a countdown, no data), the deadlines calendar (static list from the seed), invoices (one sample PDF), notifications (none), the customer's real registration numbers (we show the demo tenant, then import *their* Excel live if they bring it — phase 1 import is real).

Everything built for the demo is kept; nothing is throwaway except the mock callback screen (a static React page).

---

## 3. Data import plan for a founding customer

**What they hand us.** An Excel of buildings/elevators (usually address, price, домоуправител phone), a drawer of contracts, and the ревизионни книги for some lifts. Registration numbers, inspection bodies, SIM numbers and inspection dates are usually *not* in the Excel.

**Template** (`Avroleva-Elevators-import.xlsx`/`.csv`, UTF-8 BOM, Bulgarian headers, one row per elevator, a second sheet with examples): Ползвател · Тип ползвател (етажна собственост / професионален домоуправител / фирма / институция) · Домоуправител · Телефон · Viber (да/не) · E-mail · Град · Област · Район/ж.к. · Улица и № · Блок · Вход · Асансьор № (вътрешен) · Рег. № (надзорен орган) · Надзорен орган · Производител · Година · Вид (електрически/хидравличен/MRL) · Врати (ръчни/полуавтоматични/автоматични) · Спирки · Товар (кг) · Месечна цена (€) · Договор от · Последна проверка · Последен технически преглед · Следващ технически преглед · Телефон на аварийното устройство · Оператор на SIM. Only address + one elevator is mandatory; every empty field becomes a data-quality item on the calendar ("липсва регистрационен номер", "липсва дата на преглед").

**Validation** (preview before commit): dates `дд.мм.гггг`, price numeric, stops 2–40, duplicates by (address, entrance, internal number) and by registration number, unknown област suggested from the list, phones normalised to `+359`; every error shows row, column, message; re-upload until zero blocking errors (warnings allowed). A committed batch can be rolled back until the first visit is recorded against any of its elevators.

**Geocoding.** Background job, Nominatim with Bulgarian normalisation (`ж.к.` → complex, `бл.` → block, `вх.` dropped), confidence stored; anything unresolved or below threshold goes to the office "постави на картата" list where a pin is dragged onto the map; the technician can confirm the location on the first visit as a proposed correction. Expect 60–80 % automatic success on Sofia panel-block addresses.

**Registration numbers and inspection bodies.** Free text in the template; `regNoNormalized` strips spaces and unifies Cyrillic/Latin lookalikes; the inspection body is fuzzy-matched to the seeded open-data list with manual confirmation. Missing numbers are collected in the field: the technician photographs the cabin sticker / plate / ревизионна книга at the first visit (an onboarding checklist item "снимай стикера") and the office fills the number from the photo. The founding offer includes us entering the data, so the founder does the first import with the owner on a call.

**Contracts.** One contract per building from the Excel (start date, price per elevator); the signed paper contract is scanned to the dossier later. History before the import date is not reconstructed.

---

## 4. Risks and how the architecture contains them

| Risk | Containment |
|---|---|
| ДАМТН's electronic system (чл. 9 ал. 10) comes alive and demands per-visit filing | Out of MVP scope by decision (D21); visits, callbacks and contract changes are already events with full payloads, so a filing adapter could be added later without a model change if a paying customer asks. |
| Inspectors reject the printed дневник page | The paper book stays the legal record — the app never claimed otherwise; the page template is data (per-tenant override, versioned); the photo of the handwritten page remains the primary evidence; worst case the print feature is turned off per tenant and nothing else changes. |
| Technicians refuse the app | `officeVisitEntry` flag: the office enters visits from a photo of the page (same evidence model, `source=paper`); the owner still gets the calendar, letters, callbacks and invoices; a "Бях тук" one-tap mode (visit without checklist, flagged) lowers the bar; the QR sticker makes the phone the natural tool for callbacks first. |
| A firm asks for per-elevator or flat pricing | Pricing is a plan row with a strategy; a custom plan per tenant; no deploy. |
| A firm with lifts in three regions | Nothing in the MVP depends on the region; `building.address.oblast` is stored, so a per-region view later is a query, not a model change. |
| Viber replaced / Viber Business too expensive | Channel adapters behind `ViberSender`; deep-link mode costs nothing; rules point at whichever channel exists. |
| Per-block pricing tempts firms to leave elevators unregistered, which hollows out the evidence product | Usage counts elevators with an *active contract* only; `outOfContract`/`scrapped` are free; the pricing rule can add a free tail later without code. Flagged to the founder as a product risk. |
| iOS Safari evicts PWA storage | Home-screen install is part of onboarding; `storage.persist()`; sync watermark makes recovery a re-pull; outbox drains at every opportunity; Capacitor wrapper is the escape hatch and is pre-wired. |
| Chromium exhausts VPS RAM | Concurrency 1, idle close, `PdfRenderer` port → Gotenberg sidecar or external API. |
| The offline API and the deployed server drift | Versioned outbox payloads with upcasters for N-1; `X-Min-Client-Version`; the integration test pushes a stale payload on every CI run. |
| Data loss / disputed evidence | Append-only evidence, hash-chained audit, offsite encrypted backups, quarterly restore drill, full export any time. |
| The founder is the only person who can deploy or restore | `scripts/deploy.sh`, `restore-drill.sh`, and this document; runbooks are tested in CI where possible. |

---

## 5. Definition of done — "first customer live"

- [ ] Own domain in front of the same container (certbot done), PWA installed from that origin on every technician's phone; old path-prefix URL redirects.
- [ ] The customer's portfolio imported (≥ 95 % of elevators geocoded or pinned), every elevator with a QR label printed and stuck in the cabin or machine room, contracts with prices entered.
- [ ] One full 30-day cycle recorded through the app by all technicians, with on-schedule / overdue status visible on the board and at least one visit whose дневник page was printed and filed in the book.
- [ ] At least one real callback recorded end to end with the response-time timer, and one defect notice to a building issued.
- [ ] Inspection dates entered for every elevator that has one, with the alerts visible on the calendar.
- [ ] Month-end invoices issued from the app (or pushed to their invoicing tool), accountant has confirmed the PDF fields, arrears list matches their notebook.
- [ ] Notification rules the owner chose are on and have delivered; the домоуправители of two buildings have received a monthly report.
- [ ] Owner has exported their data once and opened it in Excel, and has seen the "delete my data" option and its 30-day grace ("your data leaves with you" demonstrated, not promised).
- [ ] Nightly backups running with an offsite copy; one restore drill executed; UptimeRobot alerting the founder; Sentry (or log alerts) quiet for a week.
- [ ] Tenant-isolation, unit and integration suites green; the Playwright offline smoke green on the release tag; `docs/adr/` has an entry for every decision changed during onboarding.
- [ ] Subscription row in `trialing` with the correct end date; the pricing plan for their elevator count reviewed with the founder.
- [ ] The three "questions only a firm can answer" that affect the model (real check cadence, how after-hours calls arrive and are evidenced, whether inspectors accept the page) recorded in `docs/adr/` with the tenant's settings adjusted accordingly.
