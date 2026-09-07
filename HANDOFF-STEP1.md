# Avroleva — Handoff after step 1 (foundation)

Date: 2026-09-08. Read `ARCHITECTURE.md` and `MVP-PLAN.md` first; this file says what of them exists in code today, how to run it, and exactly what step 2 (dashboard) has to add.

## 1. What exists

npm-workspaces monorepo (`packages/*` build before `apps/*`):

| Path | What |
|---|---|
| `packages/i18n` | `bg.json` (source of truth) + `en.json`, `t(key, params)` with ICU-lite `{n, plural, …}` / `{x, select, …}`, `resolveLocale(user, tenant) → 'bg'`, `Intl` helpers (`formatDate/DateTime/Number/Money`, BGN reference at 1.95583). Test fails if any bg key is missing/extra in another locale or not registered in `locales/index.ts`. Adding a language = add `<code>.json` + one line in `src/locales/index.ts`. |
| `packages/contracts` | zod 4 schemas for every request body / query + TS DTO interfaces shared by API and office (`enums.ts` values = Postgres enum values). |
| `apps/api` | Express 5 + Prisma 6 + PostgreSQL. `platform/` (config, prisma + tenant guard, RFC 7807 errors, ctx/guards/CSRF, request-id, pino, events bus, audit, ports+adapters, i18n), `modules/tenancy`, `modules/registry`, skeleton `index.ts` for every other module, `http/` facade (router, admin, static SPA). |
| `apps/office` | React 19 + Vite 7 + react-router 7, plain CSS, Leaflet map. Login, shell with nav + language switch, list/detail/edit for buildings, elevators, customers (+contacts), contracts, users (owner), settings, CSV import, platform-admin pages under `/admin`. |
| `docker/Dockerfile`, `docker-compose.prod.yml` | UNTESTED sketches for the VPS (port 3005, `/avroleva/` prefix). `docker-compose.yml` = optional local Postgres. |

Module rules from ARCHITECTURE §1.1 are followed: modules import lower layers only, through `index.ts`; ESLint blocks imports of another module's `repo/`, `domain/`, `http/`. Table ownership map: `apps/api/src/platform/db/ownership.ts`.

## 2. How to run

```bash
# 0. Postgres: the shared dev container (unclecrm-db on localhost:5432) or `docker compose up -d db` (127.0.0.1:5436, then change DATABASE_URL)
cp .env.example .env          # one .env at the repo root; apps/api reads it
npm install
npm run db:migrate            # prisma migrate dev  -> creates the `avroleva` database + tables
npm run db:seed               # platform admin from ADMIN_USERNAME/ADMIN_PASSWORD + demo tenant (SEED_DEMO=true), idempotent
npm run dev                   # builds packages, then: tsc --watch packages | API on :3005 | Vite office on :5175 (proxies /api -> 3005)
npm test                      # i18n tests + API unit tests + API integration tests (creates/migrates `avroleva_test`)
npm run lint                  # eslint + prettier --check
npm run build                 # packages -> api (prisma generate + tsc) -> office (vite build); API then serves apps/office/dist at /
```

Ports: API **3005**, Vite dev **5175**, Postgres per `DATABASE_URL`. Health: `GET http://localhost:3005/api/v1/health` → `{ok, db, version, time}`.

Env vars (`.env.example` documents every one): `DATABASE_URL`, `TEST_DATABASE_URL` (default: `…/avroleva_test`), `PORT`, `NODE_ENV`, `LOG_LEVEL`, `BASE_PATH` + `VITE_BASE` (A11; both default `/`; behind nginx use `/avroleva` and `/avroleva/`), `PUBLIC_BASE_URL`, `COOKIE_SECURE` (`true` behind HTTPS → also `trust proxy`), `SESSION_SECRET` (must change in production), `ADMIN_USERNAME`/`ADMIN_PASSWORD`, `SEED_DEMO`, `GEOCODER=nominatim|stub`, `NOMINATIM_URL`, `EMAIL_PROVIDER`/`SMS_PROVIDER` (console only), `VITE_MAP_TILES_URL`, `OFFICE_DIST`.

### Seeded credentials (dev only)

| Who | Username | Password | Where |
|---|---|---|---|
| Platform admin | `admin` (env) | `admin12345` (env) | `/admin/login` |
| Demo owner | `demo` | `demo1234` | `/login` |
| Demo office user | `maria` | `demo1234` | `/login` |
| Demo technician | `ivan` | `demo1234` | `/login` (read-only registry) |

Demo tenant "Демо Лифт Сервиз": 6 customers, 12 Sofia buildings with coordinates and house-manager contacts, 20 elevators (statuses: active / stopped_by_firm / stopped_by_authority / out_of_contract / scrapped; intervals 10/15/30/45 days; `lastCheckAt` chosen so several are due **today**, some **tomorrow**, several **overdue**; the seed recomputes these dates relative to "today" on every run), one active contract per building with per-elevator prices.

## 3. Auth & tenancy as implemented

- Login is **username + password** (`POST /api/v1/auth/login`); usernames are **globally unique** (no tenant picker on the login form). Passwords bcrypt cost 12, min 8 chars.
- Session = 32 random bytes; only its sha256 is stored (`session.tokenHash`); delivered as httpOnly cookie `avroleva_session` (SameSite=Lax, Path=/, Secure when `COOKIE_SECURE=true`) **and** returned in the login body as `token` for `Authorization: Bearer` clients — one code path (`modules/tenancy/http/auth.middleware.ts`). Browser sessions 30 days sliding (touched at most hourly); device sessions (180 d) exist in the model for step 3.
- CSRF: every cookie-authenticated request and every mutating request without Bearer must send `X-Requested-With: avroleva` (403 `auth.csrf` otherwise).
- Platform admin has its own cookie `avroleva_admin` (session `kind=admin`, 12 h sliding), so an admin and a tenant user can be signed in side by side in one browser.
- `req.ctx = {tenantId, userId, role, sessionId, requestId, locale, t}` is built from the session only. Prisma client extension (`platform/db/prisma.ts`) **throws** on any query on a tenant-owned model without `tenantId` in `where`/`data`. Cross-tenant ids → 404 (never 403); non-UUID ids → 404.
- Roles: owner (everything), office (all registry writes, no users/settings), technician (read-only registry). Rate limits: login 20/15 min per IP, API 600/min per IP (skipped in tests).
- Errors are RFC 7807 (`application/problem+json`): `{type, title, status, code, detail?, fields?[], requestId}`; `code` and field codes are i18n keys, `title`/`message` are resolved server-side in the user's locale (user.locale → tenant.locale → Accept-Language → bg).

## 4. API endpoints (`/api/v1`)

Auth/tenant/users (tenancy): `POST auth/login`, `POST auth/logout`, `GET auth/me`, `PATCH auth/me {locale,name}`, `GET tenant`, `PATCH tenant` (owner), `GET users` (owner/office), `POST users` (owner), `PATCH users/:id` (owner; role/isActive/…; guards last owner + self-deactivation), `POST users/:id/password` (owner).

Registry (all require auth; writes need owner/office; lists are cursor-paginated `{items, nextCursor}` with `?cursor&limit≤200&q`):
- `customers`: `GET`, `POST`, `GET :id`, `PATCH :id`, `DELETE :id` (archive). Filter `kind`.
- `contacts`: `GET ?customerId|buildingId`, `POST`, `PATCH :id`, `DELETE :id`.
- `buildings`: `GET ?customerId&geocodeStatus`, `GET buildings/pins` (all geocoded buildings: id, addressText, lat, lng, elevatorCount), `POST`, `GET :id` (detail with elevators, contacts, contracts), `PATCH :id`, `PUT :id/location {lat,lng}`, `POST :id/geocode` (Nominatim via `Geocoder` port; stub in tests), `DELETE :id` (409 if it has elevators).
- `elevators`: `GET ?buildingId&status`, `POST`, `GET :id`, `PATCH :id`, `DELETE :id` (only out_of_contract/scrapped). DTO carries `effectiveIntervalDays` and `nextCheckDue = lastCheckAt + interval`.
- `contracts`: `GET ?customerId&buildingId&status`, `POST` (with `lines[{elevatorId, monthlyPriceCents}]`), `GET :id`, `PATCH :id` (lines replaced), `POST :id/terminate {endDate, reason}` (elevators without another active contract → `out_of_contract`), `DELETE :id` (only non-active).
- `imports`: `GET imports/template.csv` (UTF-8 BOM, `;`, Bulgarian headers from MVP-PLAN §3 + `Ширина`/`Дължина`), `POST imports/preview {filename, csv}` → batch with rows + issues, `POST imports/:id/commit`, `GET imports`, `GET imports/:id`.

Platform admin (`/admin`, own cookie): `POST admin/auth/login|logout`, `GET admin/auth/me`, `GET admin/tenants` (with counts), `POST admin/tenants` (tenant + first owner), `GET admin/tenants/:id` (+ users), `PATCH admin/tenants/:id {status: active|read_only|closed, name}` (closed revokes sessions and blocks login), `POST admin/tenants/:id/users/:userId/password`.

`GET health`.

## 5. Data model as implemented (Prisma, `apps/api/prisma/schema.prisma`)

Tables: `tenant`, `user`, `platform_admin`, `session`, `customer`, `contact`, `building`, `elevator`, `contract`, `contract_elevator`, `import_batch`, `domain_event`, `audit_log`. UUIDv7 ids generated in code (`platform/ids.ts`), `tenantId` first in every index, `createdAt/updatedAt`, soft delete `deletedAt` on master data, Postgres enums, JSONB for `address`, `settings`, `features`, import rows.

Deviations from ARCHITECTURE §3, and why:
- **Enum values** follow the task brief rather than the doc's camelCase: `CustomerKind = etazhna_sobstvenost | professional_manager | company | institution`, `ElevatorStatus = active | stopped_by_firm | stopped_by_authority | out_of_contract | scrapped`, `DoorType = manual | semi_auto | auto`, `ContactRole = house_manager | cashier | manager | other`, `TenantStatus = active | read_only | closed`.
- **`user.username` is globally unique** (login has no tenant field). If two firms want the same username, that is a product decision for later (tenant slug prefix).
- **One `session` table** for tenant users and platform admins (`tenantId`/`userId` nullable, `adminId` + `kind=admin`), instead of a separate admin session table.
- **`elevator`** has a subset of the doc's fields: `internalNo, regNo, regNoNormalized, inspectionBody (free text, not FK), manufacturer, year, driveType, doorType, stops, loadKg, status, checkIntervalDays, lastCheckAt, nextInspectionAt, alarmDevicePhone, alarmSimOperator, publicCode, notes`. Not yet: `serialNo, installer, goodsOnly, persons, speedMs, controllerBrand, commissioningDate, alarmDevice JSONB, retrofit JSONB, stopReason, stoppedAt, restartAuthority, lastInspectionAt, stickerYear, nextCheckDue column` (nextCheckDue is computed in the DTO for now; step 2 decides whether to denormalise it).
- **`inspection_body` reference table, `document*`, `idempotency_key`**: not created (no dependency yet).
- **Money**: `contract_elevator.monthlyPriceCents` (integer cents, per §3) — the brief said `monthlyPriceEur`; the office shows EUR (and the optional BGN reference).
- **Encryption** of `building.accessNotes/keysLocation`: plain text for now (GDPR item, not started).
- **Audit log**: rows written for every mutation (actor, request, before/after) but **no hash chain / INSERT-only grants** yet.
- **Events**: `platform/events/bus.ts` persists `domain_event` rows and dispatches subscribers in-process (`setImmediate`); same `EventBus` interface the pg-boss outbox will implement. Subscribers are registered in `apps/api/src/subscribers.ts` (currently log only).
- **Contract lines on PATCH are replaced**, not versioned (history-preserving lines come with billing).
- No `dependency-cruiser`/ownership CI script yet — an ESLint `no-restricted-imports` rule covers rule 1; rule 3 is by convention.

## 6. Known gaps / not done in step 1 (by design)

Technician PWA, offline sync, PDF/Chromium, pg-boss + outbox worker, notification providers (console only), file storage/attachments, QR label sheet + public page (`publicCode` is already on every elevator), CSV export endpoints, import rollback (`import_batch.createdRows` already records the ids per table), Docker/CI verified on the VPS, backups, encryption, hash-chained audit, `dependency-cruiser`. The office CSV upload reads UTF-8 (or falls back to windows-1251) client-side and posts the text — no multipart yet.

## 7. Step 2 — dashboard: what to build and what the API still needs

Target (from the brief): a dashboard with a **map of clickable elevator pins**, a **due today / tomorrow widget**, an **elevator popup with maintenance and payment history**, and a **payments widget**.

What already exists for it:
- `GET /buildings/pins` (buildings with lat/lng + elevator counts); `GET /elevators?buildingId=` and `GET /buildings/:id` (elevators with `nextCheckDue`, status, contract lines).
- `ElevatorDto.effectiveIntervalDays` / `nextCheckDue` (registry hint: `lastCheckAt + interval`) and the tenant setting `checkIntervalDays` (+ `cycleStrategy` stored, not applied).
- Events `ElevatorRegistered`, `ElevatorStatusChanged`, `ElevatorUpdated`, `ContractStarted`, `ContractTerminated` already published; subscribe in `apps/api/src/subscribers.ts`.
- Office: `MapPicker` (Leaflet, single pin) to generalise into a multi-pin map; `dueBadge()` in `pages/elevators/ElevatorsListPage.tsx`; `DashboardPage.tsx` placeholder; i18n keys for statuses/due labels.

**Endpoints step 2 still needs to add** (suggested shapes; all tenant-scoped, cursor-paginated where lists):
1. `maintenance` module (L3, owns `maintenance_job`): 
   - `GET /api/v1/maintenance/due?from=&to=` → jobs due in a window with elevator + building (address, lat/lng, contact phone), status `planned|assigned|done|missed`; a `dueBoard` grouping (overdue / today / tomorrow / this week).
   - `POST /api/v1/maintenance/jobs/generate` (idempotent "ensure every active in-contract elevator has one open job", also run on `ElevatorRegistered`/`ContractStarted`; cancel on `ContractTerminated`/status ≠ active).
   - Pure `nextDue(lastDone, elevator, settings)` implementing `rolling` and `calendar_month` (A3) — move/extend `modules/registry/domain/due.ts`.
2. `visits` module (L3, owns `visit`, `visit_technician`): 
   - `POST /api/v1/visits` (office entry, `source=paper|office`: elevatorId, kind, startedAt/finishedAt, technicians, remarks; idempotent on client id) → completes the open job and denormalises `elevator.lastCheckAt` (registry command `setLastCheck` through its index.ts, or an event handler).
   - `GET /api/v1/elevators/:id/visits` (history for the popup) and `GET /api/v1/visits?from&to`.
3. `billing` light (L3, owns `invoice`, `invoice_line`, `payment`): 
   - `GET /api/v1/billing/summary` (unpaid per building, overdue buckets 30/60/90) for the payments widget; 
   - `POST /api/v1/billing/invoices/draft-period {period}` (per building from contract lines), `POST …/invoices/:id/issue`, `POST …/payments` (invoiceId or contractId + amountCents + method + receivedAt), `GET /api/v1/buildings/:id/payments` and `GET /api/v1/elevators/:id/billing` (payment history for the popup, derived from the elevator's contract lines).
4. `reporting.dashboard` (L4): one `GET /api/v1/dashboard` returning counts (due today/tomorrow/overdue, stopped elevators, unpaid buildings) + the pin list `{elevatorId, buildingId, lat, lng, status, dueState}` so the map needs a single round trip.
5. Small registry additions: `GET /elevators?dueBefore=&dueAfter=` filter (or leave to maintenance), optional denormalised `elevator.nextCheckDue` column with an index.

Conventions to keep: new tables owned by exactly one module (update `ownership.ts`), cross-module references as `(sourceType, sourceId)` without FKs (except to `tenant`, `user`, `building`, `elevator`), commands through `index.ts`, side effects through `events`, every new user-visible string in `bg.json` + `en.json`, every new route covered by the tenant-isolation test (extend `test/integration/api.test.ts`).
