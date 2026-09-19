# Avroleva Elevators — Phase 2 report (steps 7–10 + QA, release 0.2.0)

Date: 2026-09-10. Phase 1 is recorded in `MORNING-REPORT.md`. Nothing in this phase has been pushed or deployed: the commits sit on local `main`, the VPS still runs the phase-1 build.

## 1. What steps 7–10 added

| Step | What | Screenshots (`docs/screenshots/`) |
| --- | --- | --- |
| 7 — billing that runs itself | Scheduled invoice runs (monthly / quarterly / yearly, run day per firm, contract overrides), dunning as data (reminder stages, optional late fee), credit notes, partial / unallocated payments, bank-statement CSV import (three presets, auto-match by reference or amount + name, manual match), building statement (ledger, print, e-mail), EPC QR + IBAN block on every document, payment-provider port (demo adapter; IRIS and Stripe stubs), demo mode per tenant (generated data, nightly reset, "ДЕМО" banner). | `billing-settings.png`, `invoice-qr.png`, `bank-import.png`, `statement.png` |
| 8 — repair jobs, address search | Jobs = quotes through data-driven stages (draft → quoted → awaiting approval → approved with evidence → scheduled → in progress → done → invoiced; rejected / cancelled), created from a defect, callback, visit, elevator or the office; quote versions, printable quote by e-mail / Viber, scheduling, completion recording a repair visit (also from the phone, offline), full / deposit invoices through billing, approval reminders, board / list, dashboard strip with the "done, not invoiced" value. Address search (Nominatim behind the Geocoder port) with a draggable pin and "Добави асансьор тук"; "Постави на картата" for buildings without coordinates. | `jobs.png`, `job-detail.png`, `add-elevator-search.png` |
| 9 — zones, day plan, statement link | Zones (polygon / district names, automatic assignment with override), technician pairs, "План за деня" (one route per pair with ETAs and km, drag-and-drop, lock, publish to the phones, stops completing themselves), the tech app's Today list driven by the plan, building statement magic link `/s/:token` generated / rotated / revoked / sent from the building page and carried by dunning and report e-mails. | `day-plan.png`, `statement-link.png`, `public-statement.png` |
| 10 — native Android app | The technician PWA wrapped with Capacitor 7 (camera, geolocation, preferences, share, network, deep links behind platform seams), runtime-configurable server, bearer-only device sessions, CORS for the app origin, signed APK 0.6.0 served from `/downloads/` with a Bulgarian install page and QR; keystore custody in `docs/ANDROID-RELEASE.md`. | `tech-today.png`; emulator run in `HANDOFF-STEP10.md` §5 |

## 2. QA pass (2026-09-10, `docs/QA-2026-09-10.md`)

Every office route crawled in Bulgarian and English at 1280 px and in Bulgarian at 820 px; every page and dialog of steps 7–10 driven through the real UI (EPC QR decoded from the rendered page, bank import with a fixture, statement link opened cookie-less then revoked, a repair job from defect to invoice, address search → pin → "add an elevator here", plan board drag / move / lock / publish, demo payment page, a second company with demo data, role boundaries, the technician app online → API killed → online, `/downloads/` with a dummy APK). Seven bugs found and fixed, with regression tests where the API was involved:

1. **High** — a settings page that saved only its own block (Планиране, the general page, a partial billing patch, the bank-import preview) reset every other block to the defaults: bank details, payment provider, run day, jobs, planning. `patchOf()` left zod 4 `.prefault()`s in place (they fire even behind `.optional()`) and the service shallow-merged. Now deep-merged and re-parsed; 11 tests (`72e43f8`).
2. The top-bar language switch did not persist across a reload (`4869f91`).
3. Raw i18n keys for the step-7 notification events and step-7/8 templates, bg and en (`4869f91`).
4. The notifications log printed a skipped delivery's reason as an i18n key (`4869f91`).
5. `/print/quote` lacked the favicon of the other print pages (`4869f91`).
6. The office role could rewrite dunning stages and late-fee rules through the API on an owner-only page (`97ca644`).
7. The technician's job page rendered zeroed price columns ("0,00 €") — nothing leaked, but money columns on a technician screen (`97ca644`).

Security quick-check: `/s/:token` 60/min limiter and revoked → 404; `/pay/demo` 404 outside demo mode; `/downloads/tech.apk` traversal impossible (constant path, raw `..` requests → 404); `/geo/search` role-gated, upstream serialised at 1 req/s; cross-tenant 404s (suites + the second company); no secrets tracked.

## 3. Tests and gates

`npm test`: i18n 12 + API 355 = **367** (phase 1 ended at 215; steps 7–10 added 128, the QA pass 12). `npm run lint`, `npm run typecheck`, `npm run build` green on the release commit. Timing-sensitive tests (step2 due-date subscriber, step6 event sweep, step9a replay) can flake under heavy CPU load; green on a quiet machine.

## 4. Android app: rebuild and sideload

Not rebuilt for 0.2.0 — nothing under `apps/tech` changed; the app stays **0.6.0** (`D:\Code\Avroleva\Avroleva Elevators\Releases\avroleva-elevators-tech-0.6.0.apk`). To rebuild (PowerShell, repo root; `docs/ANDROID-RELEASE.md` §3):

```powershell
npm run build:packages
cd apps\tech            # bump "version" in package.json first (versionCode derives from it)
$env:APK_OUT_DIR = 'D:\Code\Avroleva\Avroleva Elevators\Releases'
npm run android:release # build:native -> cap sync android -> gradlew assembleRelease -> copy
& "$env:LOCALAPPDATA\Android\Sdk\build-tools\35.0.0\apksigner.bat" verify --print-certs android\app\build\outputs\apk\release\app-release.apk
```

`android/keystore.properties` must exist (password in `%USERPROFILE%\.avroleva\android-keystore.txt`). **Losing the keystore or its password means no future build installs over the existing ones** — back both up outside the laptop.

Sideload: copy the APK to `DATA_DIR/releases/tech.apk` on the `avroleva_data` volume (`DEPLOY.md` §7); on the phone open `https://srv1662742.hstgr.cloud/avroleva/elevators-v1/downloads/`, "Изтегли приложението", open the file, allow installs from the browser, "Инсталирай въпреки това" at Play Protect, open Avroleva Elevators, scan the enrollment QR from Потребители → "Свържи телефон". Developer install: `adb install -r <apk>`.

## 5. Still stubbed (by design for 0.2.0)

- **IRIS and Stripe** adapters: wired (keys validated, webhook route answers 501, "предстои" in the selector), not integrated — one file each plus a webhook-signature test once a provider is chosen.
- **SMS**: none by design — console and generic-HTTP adapters exist, no Bulgarian gateway; Viber deep links and e-mail carry customer messages.
- **Viber Business**: outbound Viber is a deep link sent by hand; a Viber Business account is the founder's call.
- Bank import reads CSV only (invented presets — the first real export should become a fixture); no PDF; straight-line routing; archiving a pair leaves its plans on the board; the Android app was verified in the emulator, not on a phone; App Links need `assetlinks.json` at the host root.

## 6. Open decisions for the founder

1. **Domain** — QR labels, the APK's baked-in server and the statement links all carry `srv1662742.hstgr.cloud/avroleva/elevators-v1`; a custom domain before the first customer avoids re-printing and re-enrolling (`DEPLOY.md` §9).
2. **Payment provider** — IRIS, Stripe, or neither (IBAN + EPC QR already lets a house manager pay from mobile banking in one scan).
3. **Play Store** — sideloading needs no account; a listing needs a developer account, the keystore held for life, a privacy page.
4. **Public arrears** — `showPaymentOnPublicPage` stays off by default; each firm opts in.
5. **Demo tenant on the VPS** — keep it for sales calls, or register the founding customer only.

## 7. Deploying 0.2.0 (orchestrator)

- Push `main`, deploy per `DEPLOY.md` §7. Migrations applied by `prisma migrate deploy` (all additive): `20260909000000_billing_payments_demo`, `20260910000000_invoice_contract_nullable`, `20260910000100_jobs_stages`, `20260910000200_step9_zones_day_plans_access_links`.
- VPS `.env`: **no new variable required** — `DATA_DIR=/data` and the volume come from `docker-compose.prod.yml`; keep `MIN_CLIENT_VERSION=0.4.0` until every phone runs 0.6.0. Optional, leave unset: `IRIS_API_KEY`, `IRIS_WEBHOOK_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.
- Copy the APK to `DATA_DIR/releases/tech.apk`; check `…/avroleva/elevators-v1/downloads/tech.apk` answers 200 with `application/vnd.android.package-archive`.
- Optional: `/.well-known/assetlinks.json` at the host root with the certificate SHA-256 from `HANDOFF-STEP10.md`; then the real-phone pass of `HANDOFF-STEP10.md` §8.
