# Avroleva — Handoff after step 4 (offline technician app, attachments, sync)

Date: 2026-09-08. Read `ARCHITECTURE.md` (§4 offline PWA, §5 API, §6 file storage), `MVP-PLAN.md` and `HANDOFF-STEP1..3.md` first; this file says what step 4 added, how a phone is enrolled, how the sync protocol works, where files live, what is missing, and what step 5 needs.

Vocabulary rule kept: every user-visible string is operational (посещение, функционална проверка, техническо обслужване, авария, дефект, машинно помещение, монтьор). The paper дневник stays the legal book — the app produces the office record and a printable page in the same layout; the words "ДАМТН" / "compliance" / "закон" do not appear anywhere in the UI. The checklist JSON carries only the appendix reference (`ref`) for the office.

## 1. What exists now

| Area | What |
|---|---|
| `packages/domain-data/checklists/functional-check.v1.json` | The functional-check items as data: 9 groups (cabin/landing panels + lighting; shaft doors for manual/semi-automatic; automatic doors; goods-only lifts; cabin stop button / roof hatch / apron; machine room electric incl. full rope length, sheave grooves, governor, final limits; hydraulic; control panel; landing panels), 32 items with `code`, bg/en label, `appliesTo {driveType[], doorType[], goodsOnly?}`, `resultType ok_defect_na`. Loaded by `domain-data/src/index.ts`; `applicableItems()` (pure, in `packages/contracts/checklists.ts`) filters for a lift and is shared by the API and the phone. |
| `modules/maintenance` | Now owns `checklist_template` (system row `tenantId NULL` per key/version + optional tenant clones that shadow it). `GET /checklists` (tenant's active set), `GET /checklists/active?elevatorId[&key]` (filtered for the lift). `checklists.snapshotFor()` turns answers `{code,result,note}` into the stored snapshot with labels/groups — wired into visits through a **port** (`visits/domain/ports.ts: ChecklistResolver`, composed in `app.ts`), same layer rule as `VisitRecorder`. `ensureSystemTemplates()` runs in every seed. |
| `modules/documents` (L2, new) | Tables `attachment`, `visit_attachment` (plain ids on both sides — the visit arrives before its photos). `POST /attachments` (multipart ≤ 20 MB, fields `id`, `sha256`, `kind`, `takenAt`; hash verified on the bytes as received; `sharp` re-encodes to ≤ 1600 px JPEG q80 with EXIF/GPS stripped, 320 px thumbnail; idempotent on the client id, 409 if the same id comes with other bytes). `GET /attachments/:id`. **Signed URLs** `GET /files/:id?v=full|thumb&exp&sig` mounted outside `/api` (no cookie, no CSRF): HMAC-SHA256 with `SESSION_SECRET` over `id|variant|exp|tenantId`, 15 min, verified against the row's tenant; malformed/expired/tampered → 404. `FileStorage` port (`platform/ports/storage.ts`) + `local` adapter writing `DATA_DIR/attachments/<tenantId>/<yy>/<mm>/<id>.jpg` and `<id>.thumb.jpg` (temp file + rename). |
| `modules/tenancy` | `device_enrollment_token` (sha256 of a 24-byte code, 10 min, single use). `POST /users/:id/enroll-token` (owner/office) → `{token, expiresAt, url, qrSvg}`; the QR encodes `<PUBLIC_BASE_URL><BASE_PATH>/tech/?enroll=<code>` so a phone camera opens the app already enrolling. `POST /auth/enroll {token, deviceName, clientVersion}` → device session (`kind=device`, 180 days sliding) as Bearer. `GET /auth/sessions` + `POST /auth/sessions/:id/revoke` (owner: "излез от този телефон"). `X-Client: app` counts as the CSRF header (a cross-site form cannot set it), which is what lets the enroll call work before the phone has a token. |
| `modules/visits` | Visit rows gain `timestampSource` (device/server/manual), `clientOffsetMs`, `templateKey`, `templateVersion`, `checklist` JSONB (snapshot with labels + summary), `gps`. `POST /visits` accepts `checklist`, `attachments[{id, role}]`, provenance. `qualityFlags`: `singleTechnician` (fewer than `settings.minTechnicians[kind]`), `endBeforeStart`, `clockSuspect` (device offset > 2 min or timestamp > 5 min ahead of receipt), and `pendingUploads` computed on read while a linked photo has not landed. DTO carries `attachments[]` with signed URLs, `receivedAt`, `checklist.summary`. |
| `modules/registry` | `elevator.goodsOnly` (form checkbox, sync, checklist filter); sync read models `listAllForSync(tenantId, since)` for buildings / elevators / contacts (tombstones included). |
| `modules/callbacks` / `defects` | Callback transitions accept `clientOffsetMs` + `timestampSource` and store them (plus `qualityFlags: ['clockSuspect']`) in the event's `data`. Defects are idempotent on a client `id`. Both expose `listForSync` (open + changed since). |
| `http/sync.ts` (facade) | `GET /sync/pull?since` and `POST /sync/push` — see §4. `platform/http/idempotency.ts` = the `Idempotency-Key` middleware backed by `idempotency_key (tenantId, key) → requestHash, status, body`, 7-day TTL with a lazy sweep. `X-Min-Client-Version` (config `MIN_CLIENT_VERSION`, default 0.4.0) on every `/api` response; `X-Client-Version` is remembered on the session. |
| `http/print.ts` | `GET /print/logbook/:visitId` (any role incl. technician bearer): firm letterhead, lift identity, date/time, kind, technicians with signature lines, the checked items grouped (defects highlighted, N/A omitted), notes, photo thumbnails, short record id + "received at". Screenshot: `docs/screenshots/logbook-print.png`. |
| `http/static.ts` | Serves `apps/tech/dist` at `/tech/` (`TECH_DIST` env, default `../tech/dist`), SPA fallback, `no-cache` for index/sw, immutable hashed assets. The office fallback excludes `/files/` and `/tech`. |
| `apps/tech` (new workspace) | The offline-first technician PWA — §3. Screenshots: `docs/screenshots/tech-today.png` (Днес: overdue / today / tomorrow groups with call + navigate buttons), `docs/screenshots/tech-visit.png` (visit form with the filtered checklist, a defect answer opening the description + stop-lift fields). |
| office | Users page: "Свържи телефон" (QR + code + link, 10-minute countdown, "Нов код"), "Свързани устройства и сесии" table with "Излез"; visit history shows the checklist summary, quality-flag badges ("2 снимки чакат качване"), photo thumbnails (logbook page framed in blue) linking to the full image, and "Страница за дневника"; settings: minimum technicians per visit kind, "Приложение за монтьори → GPS позиция"; elevator form: "Товарен асансьор". Office dev proxy now forwards `/files` and `/tech`. |
| seed | `checklists.ensureSystemTemplates()` always; demo tenant: the 10 newest functional checks get a checklist snapshot (one with a defect item), `source=app`, `timestampSource=device`, and 15 generated placeholder JPEGs (some as `logbook_page`) written through the storage adapter — idempotent (skipped once the tenant has attachments). |

## 2. How to run

```bash
docker start unclecrm-db
npm install                     # new workspace apps/tech; API deps sharp, multer
npm run db:migrate              # applies 20260908030000_tech_app_sync_attachments
npm run db:seed                 # system checklist template + demo photos under apps/api/data/
npm run db:reset                # drop + migrate + seed the local DB (refuses non-localhost hosts; prisma migrate reset is interactive-only)
npm run dev                     # API :3005, office :5175, tech app :5176 (Vite proxies /api, /files, /print)
npm test                        # i18n 12 + API unit 75 + integration 81
npm run lint && npm run build   # build includes apps/tech (vite-plugin-pwa injectManifest)
```

Env (`.env.example`): `DATA_DIR` (default `./data`, relative to the API cwd, gitignored), `MIN_CLIENT_VERSION`, `TECH_DIST`, `VITE_TECH_BASE` (= `BASE_PATH` + `/tech/`), `VITE_API_BASE` (empty = same origin). Logins unchanged (`demo` / `maria` / `ivan`, `demo1234`).

**Dev-database safety.** `test/helpers.ts: resetDb()` refuses to truncate a database whose name does not contain "test" (a test run in a shell without `NODE_ENV=test` wiped the dev data once during step 4; `npm run db:seed` restores the demo tenant).

**Migration naming.** `prisma migrate dev` named the step-4 migration `20260908001042_…`, which sorts *before* the step-2/3 folders (the same P3006 trap as in step 3); it was renamed to `20260908030000_tech_app_sync_attachments` and the `_prisma_migrations` row of the local `avroleva` database updated by hand. `avroleva_test` received it under the new name. Any other database that applied the old name needs the same one-line `UPDATE`.

## 3. Enrolling a phone

1. Office (owner/office) → **Потребители** → "Свържи телефон" next to the technician. The card shows a QR, the code and the link; valid 10 minutes, single use.
2. On the phone: scan the QR with the camera app (opens `<base>/tech/?enroll=<code>`), or open `<base>/tech/` and paste the code, or use "Сканирай QR" inside the app (BarcodeDetector on Android Chrome). Type a device name → "Свържи".
3. The app stores the device session (Bearer, 180 days sliding) and runs the first pull. Install to the home screen (iOS may evict PWA storage after 7 days of non-use otherwise).
4. The owner sees the phone under "Свързани устройства и сесии" and can end it with "Излез". After that the app keeps every local record and asks to be connected again; the outbox resumes with the new session.

Dev: office at `http://localhost:5175`, tech app at `http://localhost:5176/tech/` (QR links point at `PUBLIC_BASE_URL`, i.e. `:3005/tech/`, which serves the built app; in dev paste the code into `:5176`).

## 4. Sync protocol (`/api/v1`, Bearer device session, `X-Client: app`, `X-Client-Version`)

**Pull** `GET /sync/pull?since=<watermark>` → `SyncPullDto` (`packages/contracts/sync.ts`):
- `serverTime` / `watermark` (send it back as `since`); the phone measures `offset = serverTime − (t0 + rtt/2)` and stores `clockOffsetMs`.
- Delta collections with `updatedAt ≥ since − 2 s` (the 2 s overlap makes a missed row impossible; upserts are idempotent): `buildings` (address, entrance, coordinates, customer, access notes), `elevators` (identity, drive/door/goodsOnly, status + stop reason, last/next check, `dueState`), `contacts` (name + phone only), each with `deletedAt` tombstones.
- Full-replace sets: `jobs` (elevators overdue / today / tomorrow for the whole tenant), `callbacks` (open ones visible to the technician + changed since; closed ones arrive as `status: 'closed'`), `defects` (open + changed since; resolved = tombstone), `checklistTemplates`, `defectCatalog`, `users` (for the second-technician picker), `tenant.settings` (`minTechnicians`, …), `tenant.features.gpsCapture`, `me`.
- `visits`: rows received on the server since the watermark (first pull: last 90 days), with attachments and signed thumbnail URLs.

**Push** `POST /sync/push`, header `Idempotency-Key = item.id`, body = ONE `SyncPushItem { id, kind, schemaVersion: 1, createdAt, payload }`:
- `visit.record` = `createVisitBody` + `id` (`source: 'app'`, `timestampSource: 'device'`, `clientOffsetMs`, `checklist {templateKey, templateVersion, items[{code, result, note}]}`, `attachments[{id, role}]`, `gps?`). The server snapshots the labels, links the attachment ids **before** the photos exist, sets `qualityFlags`, moves `lastCheckAt` for check kinds.
- `defect.record` = `createDefectBody` + `id` (`sourceType: 'visit'`, `sourceId: <visitId>`) — one per checklist item marked "Дефект".
- `callback.event` = `{callbackId, type: on_site|released|restored, at, clientOffsetMs, timestampSource, notes?}` → the existing transition with `source: 'app'`.
- `visit.amend` (kept in the schema; no phone screen yet).
- Response `SyncPushResultDto { id, kind, status: 'applied'|'replayed', serverTime, result }`. Same key + same body → the stored response with `Idempotency-Replayed: true`; same key + different body → 422 `sync.idempotencyMismatch`; missing key → 400. Photos go to `POST /attachments` separately (multipart; idempotent on the attachment id; the server echoes the sha256 the client sent so the phone can drop its Blob).
- Client rules (implemented in `apps/tech/src/sync`): strict FIFO, one request in flight, parent before child (visit → its photos → its defects), backoff 5 s → 5 min on network/5xx, permanent failure on other 4xx (item marked failed, next items continue), 401 stops the drain and asks for re-enrollment without losing anything.

**Clock provenance (A13).** Every phone timestamp carries `at` (device clock), `clientOffsetMs` (last measured offset), `timestampSource = device`; the server adds `receivedAt` and never rewrites `at`. `clockSuspect` on the visit / in the callback event data when |offset| > 2 min or `at` > `receivedAt` + 5 min. Office / paper entries (`timestampSource = server`) are never flagged for the clock.

## 5. Storage layout

```
DATA_DIR/                          # ./data under apps/api in dev (gitignored); a volume in Docker
  attachments/<tenantId>/<yy>/<mm>/<attachmentId>.jpg          # ≤ 1600 px JPEG q80, no metadata
  attachments/<tenantId>/<yy>/<mm>/<attachmentId>.thumb.jpg    # 320 px
```
`attachment.storageKey` / `thumbKey` hold the relative keys; only the adapter knows the root. Tests write to `data-test/` (vitest `env.DATA_DIR`). Moving to S3-compatible storage = a second adapter behind `platform/ports/storage.ts` plus a copy script (ARCHITECTURE §6).

## 6. Browser verification done in step 4

Office (`demo`) -> Потребители -> "Свържи телефон" for `ivan` -> QR + code card; opened `http://localhost:5176/tech/?enroll=<code>` on the phone side -> device name -> Today list pulled (clock offset measured, 0 s). Recorded a functional check with "Всичко OK", one item switched to Дефект with a note, one photo plus the logbook-page photo, notes -> the outbox drained in order (visit -> 2 photos -> defect); the office API and the elevator history showed the visit as `source=app`, `timestampSource=device`, checklist 20 OK / 1 defect, both attachments uploaded (1600 px), the defect with `sourceType=visit`, and `/print/logbook/:visitId` rendered with the photos. Offline test: the API process was killed; a second visit with a photo was recorded (Today list and elevator screen kept working from Dexie, history row "чака изпращане", outbox "2 записа чакат" with the visit retrying and the photo queued behind it); after the API came back the outbox drained on its own within 40 s (backoff) and the office received the visit with its photo. The re-enrollment path was exercised for real: after a 401 the app kept every local row and the outbox, asked for a code and resumed. Screenshots: `docs/screenshots/tech-today.png`, `tech-visit.png`, `logbook-print.png`.

## 7. Tests

`npm test`: i18n (12); API unit 75 (`step4.test.ts` 16: template integrity and `applicableItems` by drive / door / goods-only, `summarizeChecklist`, quality flags incl. `minTechnicians` per kind and the clock rule for device vs server sources, `clockFlags`, signed-URL sign/verify incl. wrong tenant / variant / expiry / tamper / secret, relative URL TTL, canonical request hash, `syncPushItem` schema); API integration 81 (`step4.test.ts` 19: enroll-token → enroll → single use / expired / bogus, device Bearer without CSRF + `X-Min-Client-Version`, sessions list + revoke + cross-tenant 404, `GET /checklists/active` filtering for a semi-automatic electric lift vs a hydraulic goods-only lift with automatic doors, full pull shape, delta pull with a contact tombstone, push visit with checklist + pending photos, replay / 422 / different outbox id same visit, photo upload (hash mismatch, not-an-image, duplicate 200, re-encode to 1600 px, thumbnail 320 px), signed URLs (tamper, wrong variant, no signature, cross-tenant metadata 404), defect from the checklist stopping the lift, callback on-site event with `clockSuspect`, invalid transition 409, closed callback as a tombstone, pull returns the visit, print page for the technician and the office incl. N/A omission, cross-tenant push 404). All green; `npm run lint` and `npm run build` green.

## 8. Known gaps (by design in step 4)

- Attachments: photos only (`kind=document` rejected); no `document` rows / dossier; no upload-target negotiation (`POST /attachments/upload-target`) — the client always uploads through the API; no retention sweep; the tenant purge script does not delete files yet.
- Checklist templates: no office editor (tenant clones are a DB row away); only `functional_check` v1 ships; `technical_maintenance` reuses it on the phone.
- Sync: `visit.amend` has no phone screen; no `callback.open` from the phone (call the office); `jobs` are computed, not stored (no `maintenance_job`, no technician-pair assignment); the pull is whole-tenant (fine to ~3,000 lifts); no Background Sync retry when the app is closed on iOS (the `online` event and app start cover it).
- Idempotency keys are honoured on `/sync/push` only (the middleware is generic and can be attached elsewhere).
- Signed URLs are relative and 15 minutes; the office re-fetches lists to refresh them (an open history tab older than 15 min shows broken thumbnails until reloaded).
- Sessions page lists browser sessions too (one per login; there is no "sign out everywhere" button yet).
- The QR link points at `PUBLIC_BASE_URL/tech/` (the built app served by the API); in dev the Vite tech server at :5176 needs the code pasted.
- Print page is HTML (browser print); photos are thumbnails only.

## 9. What step 5 needs from here

- **Notifications**: subscribe in `subscribers.ts` to `VisitRecorded` (`qualityFlags` in the payload → alert the office on `clockSuspect` / `singleTechnician`), `DefectRecorded` / `StopLiftRequired` from app defects, `CallbackOnSite`. pg-boss lands here; the `idempotency_key` sweep, the retention sweep and the signed-URL-free export links belong to the same worker.
- **Exports**: add `visit` (checklist flattened: one column per item code), `visit_attachment`, `attachment` (metadata + the files themselves in the full zip), `checklist_template`, `session` (device list) to the CSV set; the `FileStorage.get()` port is what streams photos into the zip.
- **Delete-my-data**: purge order `idempotency_key → visit_attachment → attachment (+ `FileStorage.remove` per key) → device_enrollment_token → session`, before the step-2/3 tables.
- **Monthly building report**: visits per lift with checklist summary and defects found; photos via signed URLs with a longer TTL or embedded thumbnails.
- **Scheduler**: `jobs` on the phone are derived from `nextCheckDueAt` — a `maintenance_job` table with assignment (technician pairs / routes) replaces the whole-tenant list in the pull; add `assignedUserIds` to `SyncJobDto` when it exists.
- **Capacitor wrap**: `apps/tech/src/platform/*` are the five interfaces; build with `VITE_TECH_BASE=/` and `VITE_API_BASE=https://…`, allow `capacitor://localhost` in CORS, ship.
