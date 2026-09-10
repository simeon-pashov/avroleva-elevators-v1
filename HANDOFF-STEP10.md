# Avroleva Elevators — Handoff after step 10 (native Android app of the technician PWA)

Date: 2026-09-10. Read `HANDOFF-STEP9.md` §7 (what step 10 had to deliver), `ARCHITECTURE.md` §4
(Capacitor paragraph, now "built") and `docs/ANDROID-RELEASE.md` (the release procedure and the
keystore custody rule) first. Nothing was pushed or deployed: the commits are on local `main`, the
APK sits in `D:\Code\Avroleva\Releases\` (outside the repo), the VPS still runs step 9.

## 1. What exists now

| Area | What |
| --- | --- |
| Runtime server URL (tech app 0.6.0) | "Сървър" field on the Enroll screen (native: always visible and required; PWA: under the "Сървър" disclosure) and in Settings, persisted in `secureStorage` (key `apiBase`), default from the build-time `VITE_DEFAULT_API_ORIGIN` (`https://srv1662742.hstgr.cloud/avroleva` for the release APK; PWA build = same origin as before). `platform/http.ts`: `defaultApiBase()`, `persistApiBase()`, `loadApiBase()`, `normalizeApiBase()` (trims a pasted `/tech/`). Every API call, signed file URL (`resolveUrl`) and the thumbnails follow it. Older builds kept the value in Dexie `meta.apiBase`; it is adopted once at start. |
| Enrollment links (`lib/enrollLink.ts`) | `parseEnrollLink()` understands the office QR / e-mail link `https://<host>/avroleva/tech/?enroll=<code>` (server = everything before `/tech/`), the custom scheme `avroleva-elevators://enroll?server=<origin>&token=<code>` and a bare code. Used by the QR scanner, by the code field (pasting a link fills both fields) and by the app host (cold-start launch URL + `appUrlOpen` while running → `/enroll?enroll=…&server=…`). |
| Platform seams (`apps/tech/src/platform/`) | `native.ts` (`isNativePlatform()` = `VITE_NATIVE=1` **and** `window.Capacitor.isNativePlatform()`), `secureStorage` (web localStorage / native `@capacitor/preferences` behind a write-through memory cache; `platformReady` resolves after `init()`), `camera` (native camera or gallery via `@capacitor/camera`, returns a `File` so `lib/photos.processPhoto` — 1600 px, JPEG q0.8, sha256 — runs unchanged), `geolocation`, `share`, `network` (online state; native `@capacitor/network`), `appHost` (resume → pull, deep links, back button — pops history, leaves the app from Today/Enroll —, splash hide + status bar). `http` stays fetch with the absolute base and sends `X-Client: app`, `X-Client-Version: 0.6.0`, `Authorization: Bearer` on every call. Native adapters live in `platform/native/*` and import the plugins dynamically, so the PWA bundle carries only the 1 KB web stubs. No service worker in the native build (`app/pwa.ts`). |
| Capacitor project | `apps/tech/capacitor.config.ts` (appId `bg.avroleva.elevators.tech`, appName "Avroleva Elevators", webDir `dist-native`, `androidScheme: 'https'`, cleartext off, splash/status bar in brand blue). `apps/tech/android/` committed (Capacitor 7.6, Gradle 8.11.1, AGP 8.7, compileSdk/targetSdk 35, **minSdk 26**). `app/build.gradle`: `versionName` = `apps/tech/package.json` version, `versionCode` = M·10000+m·100+p (0.6.0 → 600); release signing from the git-ignored `android/keystore.properties` (template `keystore.properties.example`) or `AVROLEVA_*` Gradle properties, unsigned when absent. Manifest: CAMERA, location, media permissions; portrait; intent filters for `avroleva-elevators://enroll` and (autoVerify) `https://srv1662742.hstgr.cloud/avroleva/tech/`. Debug variant only (`app/src/debug`): cleartext allowed so the emulator can reach a laptop API. Plugins: camera, geolocation, preferences, share, app, network, status-bar, splash-screen. |
| Scripts (`apps/tech`) | `build:native` (Vite with `VITE_NATIVE=1`, `VITE_BASE=/`, default server → `dist-native/`), `cap:sync`, `android:debug`, `android:release` (→ `scripts/gradle.mjs`: JDK 17 / SDK paths from the environment or the documented install folders, `APK_OUT_DIR` copies the APK as `avroleva-elevators-tech-<version>.apk`), `android:assets` (`scripts/gen-assets.mjs`: renders `assets/*.svg` — the office "A" with an elevator up/down arrow on #1d5fd1 — through sharp and runs `@capacitor/assets` for the adaptive icon, round/legacy icons and splash screens). |
| API | `platform/http/cors.ts` (`appCors`): exact allow-list `https://localhost`, `capacitor://localhost`, `http://localhost`, `ionic://localhost` with credentials, preflight 204 before the rate limiter/auth, exposes `X-Min-Client-Version`; mounted on `/api` and `/files`; any other origin gets no CORS headers. Device sessions work bearer-only end to end (no `Set-Cookie` on enroll, `sync/pull`/`push` with the token from the app origin). `http/downloads.ts`: `GET /downloads/` (Bulgarian install page + QR of the APK URL + file size/date) and `GET /downloads/tech.apk` (`application/vnd.android.package-archive`, `Content-Disposition: attachment`) from `DATA_DIR/releases/tech.apk`, HTML 404 when absent. Office SPA fallback excludes `/downloads`. |
| Office | Users page → "Изтегли приложението за Android" (opens `/downloads/`). |
| Keystore (never in git) | `%USERPROFILE%\.avroleva\android-release.jks` (alias `avroleva`, RSA 2048, valid to 2054-01-26) + `android-keystore.txt` (generated 40-char password, ACL owner-only). Certificate SHA-256: `D4:1E:49:FD:93:27:7A:55:1C:9E:24:FF:76:85:0A:1B:4E:0F:B5:0D:FC:5F:62:03:F3:5D:2A:C3:B6:DF:2B:EC`. |
| Toolchain | `D:\Code\Avroleva\ANDROID-TOOLCHAIN.md` (JDK 17, SDK 35, build-tools 35.0.0) **plus** a JDK 21 for the Gradle JVM: Capacitor 7.6 compiles with `sourceCompatibility 21`, so the Foojay resolver in `android/settings.gradle` provisions Temurin 21 into `~/.gradle/jdks` and `scripts/gradle.mjs` runs Gradle on it (order: `JAVA_HOME_21` → `Programs\jdk-21` → `~/.gradle/jdks` → a 21+ `JAVA_HOME`). Documented in the toolchain file (2026-09-10 update). Added during this step (user-scoped, not required for building): the emulator package, `system-images;android-35;google_apis;x86_64`, `build-tools;34.0.0` (AGP) and the AVD `avroleva35` (Pixel 6). |

## 2. Rebuild the APK

Full procedure in `docs/ANDROID-RELEASE.md` §3. Short form (PowerShell, repo root):

```powershell
npm run build:packages
cd apps\tech
# bump "version" in package.json first
$env:APK_OUT_DIR = 'D:\Code\Avroleva\Releases'
npm run android:release          # build:native -> cap sync android -> gradlew assembleRelease -> copy
& "$env:LOCALAPPDATA\Android\Sdk\build-tools\35.0.0\apksigner.bat" verify --print-certs android\app\build\outputs\apk\release\app-release.apk
```

`android/keystore.properties` must exist (copy the example, password from `android-keystore.txt`).
`JAVA_HOME` / `ANDROID_HOME` are optional: the script finds a JDK 21 (see §1 "Toolchain") and
falls back to the documented SDK path. First Gradle run after a clean `~/.gradle` downloads
~600 MB (Gradle 8.11.1, AGP, Temurin 21) and takes 10–20 minutes; later runs 1–3 minutes.

## 3. Install on a phone (sideload) — for a technician, in Bulgarian

Страницата `https://srv1662742.hstgr.cloud/avroleva/downloads/` показва същите стъпки и QR код
(офисът я отваря от „Потребители“ → „Изтегли приложението за Android“).

1. Отворете на телефона `https://srv1662742.hstgr.cloud/avroleva/downloads/` (или сканирайте QR
   кода от екрана на офиса) и натиснете **„Изтегли приложението“**.
2. Отворете изтегления файл `tech.apk` от известията или от папка „Изтегляния“.
3. Ако телефонът каже „Инсталирането от този източник не е разрешено“ → **Настройки** →
   включете **„Разрешаване от този източник“** за браузъра → назад.
4. **„Инсталиране“**. При съобщение от Play Protect → **„Инсталирай въпреки това“** (приложението
   не е в Google Play).
5. Отворете **Avroleva Elevators**. Полето „Сървър“ е попълнено. Поискайте код от офиса
   („Потребители“ → „Свържи телефон“), натиснете **„Сканирай QR“** или въведете кода, после
   **„Свържи“**.
6. Нова версия се инсталира по същия начин върху старата; данните и чакащите записи остават.

Developer install (USB debugging or the emulator): `adb install -r <apk>`.

## 4. Keystore custody

See `docs/ANDROID-RELEASE.md` §2. In one sentence: **if `android-release.jks` or its password is
lost, no future build can be installed over the existing installs and any Play listing is dead —
a new app identity is needed.** Back both files up outside the laptop (password manager entry
with the `.jks` attached); never commit, never paste the password anywhere. A debug APK and a
release APK cannot be installed over each other.

## 5. Verification

**Release APK** (2026-09-10 04:45): `D:\Code\Avroleva\Releases\avroleva-elevators-tech-0.6.0.apk`,
6,659,957 bytes (6.4 MB), SHA-256 of the file
`0433d14776b6eced1f56549587e7480638a1f473ea154192491885aab019ca3c`, byte-identical to
`apps/tech/android/app/build/outputs/apk/release/app-release.apk`.

Structural checks (all passed):

- `apksigner verify --print-certs`: verified (APK Signature Scheme v2; v1/v3 off for minSdk 26),
  signer `CN=Avroleva Elevators, O=Avroleva, C=BG`, certificate SHA-256
  `d41e49fd93277a551c9e24ff76850a1b4e0fb50dfc5f6203f35d2ac3b6df2bec` = the keystore of §1.
- `aapt2 dump badging`: `package: name='bg.avroleva.elevators.tech' versionCode='600' versionName='0.6.0'`,
  `minSdkVersion:'26'`, `targetSdkVersion:'35'`, `application-label:'Avroleva Elevators'`,
  permissions INTERNET, ACCESS_NETWORK_STATE, CAMERA, READ_MEDIA_IMAGES, READ/WRITE_EXTERNAL_STORAGE
  (capped at 32 / 29), ACCESS_COARSE/FINE_LOCATION.
- Inside the APK: 25 web files under `assets/public/`; the two `index-*.js` chunks contain
  `https://srv1662742.hstgr.cloud/avroleva` and `"0.6.0"`; `index.html` registers no service worker.
- Native adapters compile (`tsc`, `eslint`, both Gradle variants).

**Android 15 emulator** (x86_64 `google_apis`, AVD `avroleva35`, WHPX; debug APK 8.5 MB, API on
the laptop reached through `adb reverse tcp:3005` as `http://localhost:3005`, debug variant allows
cleartext):

- Install, launch: splash → Enroll screen, "Сървър" prefilled with the baked-in
  `https://srv1662742.hstgr.cloud/avroleva`, v0.6.0.
- Deep link while running (`am start -a VIEW -d 'avroleva-elevators://enroll?server=…&token=…'`,
  watched over CDP): `appUrlOpen` → `/enroll?enroll=<code>&server=http://localhost:3005`, both
  fields filled. Cold start (force-stop, then the link): same result.
- Enroll → `POST /auth/enroll` from origin `https://localhost` with `X-Client: app`,
  `X-Client-Version: 0.6.0`, no cookie → device session "sdk_gphone64_x86_64" for Иван Петров
  (`clientVersion 0.6.0`, visible in Потребители → sessions) → pull → **Today** renders (jobs,
  callbacks badge, demo banner; no day plan existed for that date any more, the board was empty).
  Preferences hold the token across a force-stop (the app reopened enrolled).
- Back button on Enroll leaves the app (launcher on top).
- Two bugs found only here and fixed before the release build: (1) `platformReady` never
  resolved — a Capacitor plugin proxy is a thenable, so a promise resolved with `Preferences`/`App`
  called `Preferences.then()` ("not implemented on android"); the adapters now resolve with the
  module namespace and read the plugin synchronously. (2) The Enroll code field seeded its state
  only at mount, so a deep link arriving while the page was open filled the server but not the
  code.

**Web build of the same code against the local API** (Vite dev server + `tsx` API, demo tenant,
Chromium): opened `/tech/?enroll=<code>` → code prefilled, "Сървър" disclosure with the hint →
Свържи → Today with the published plan (11 stops) → elevator → visit form → "Всичко OK" → Снимай
(a generated 2400×1800 JPEG fed to the file input) → thumbnail → Запиши посещението → outbox:
`POST /sync/push` 200, `POST /attachments` 201, thumbnail `GET /files/…` 200, `plan.stop` push
200. Settings shows the editable "Сървър" field and "Приложение: уеб (в браузъра)".

**Not verified on a device**: the native camera and gallery (`@capacitor/camera` UI on real
hardware), GPS capture, share sheet, network-change events during a real outage, the sideload
prompts of §3 on a phone, App Links. The emulator run stopped at Today (no visit recorded from the
native app).

## 6. Tests and gates

`npm test` (2026-09-10, quiet machine): i18n 12; API **343** = 336 from step 9 + `step10.test.ts` 7
(integration: CORS preflight for the app origin with credentials/headers/methods/`Vary`,
`capacitor://localhost` allowed and a foreign origin refused; enroll from `https://localhost` with
`X-Client: app` and no cookie; `sync/pull` + `sync/push` bearer-only, anonymous 401; the device
session listed for the office; `/downloads/` page + 404 for the APK; `DATA_DIR/releases/tech.apk`
streamed with `application/vnd.android.package-archive` and `Content-Disposition`). Total 355.
`npm run lint`, `npm run typecheck`, `npm run build` (incl. the tech web build at `/tech/`) green.

Flakiness note: while Gradle, the emulator and vitest shared the CPU, 1–4 timing-sensitive tests
(step2 due-date subscriber, step6 event sweep, step9a idempotent replay) failed with stale values;
all pass on a quiet machine (the three files re-run 33/33, then the full suite 343/343). Not related
to step 10's code, but worth a retry rule in CI.

The tech app has no unit tests (as before); `parseEnrollLink` / `normalizeApiBase` are pure and are
the first candidates when a vitest config is added to `apps/tech`.

## 7. Known gaps

- **Not run on a real phone.** Verified in the Android 15 emulator (x86_64) and structurally; a
  physical device pass (camera on real hardware, GPS, doze/background behaviour, the OS install
  prompts of §3) is step 11's job.
- App Links (`https://…/avroleva/tech/?enroll=`) open the app automatically on Android 12+ only
  after `/.well-known/assetlinks.json` is published at the **host root** (not under `/avroleva/`,
  which nginx routes to the API) — needs a small nginx location; until then the link opens the PWA
  and the custom scheme is what the app relies on. The office QR still encodes the https link
  (works for both the PWA and, when scanned from inside the app, the native app).
- The Android back button leaves the app from Today and Enroll; on other screens it pops the
  router history. No "press again to exit" toast.
- `@capacitor/camera` on Android copies the picture to the app cache before the app reads it;
  those temp files are cleaned by the OS, not by the app.
- The native build still emits `sw.js` into `dist-native/` (the vite-plugin-pwa plugin stays
  loaded); it is never registered. Harmless; a cleaner build would skip the plugin when
  `VITE_NATIVE=1`.
- No iOS project (no Mac, no Apple account). The seams are ready; `npx cap add ios` is the next
  platform.
- Changing the server in Settings while records are pending sends them to the new server on the
  next drain (documented in the field hint); the previous session token is kept — re-enrollment is
  required if the new server rejects it (401 → Enroll screen, data kept).
- `MIN_CLIENT_VERSION` on the VPS is 0.4.0; the APK reports 0.6.0. Raise it only after every phone
  has the new build.

## 8. What step 11 (QA + deploy) must do

1. `git push` and deploy per `DEPLOY.md` §7 (the API changes — CORS, `/downloads/` — are needed
   before any phone can use the APK against the VPS).
2. Copy the APK to the server: `DEPLOY.md` §7 "Android app" / `docs/ANDROID-RELEASE.md` §4
   (`scp` → `docker run … cp /s/tech.apk /d/releases/tech.apk` on the `avroleva_data` volume).
3. Verify `https://srv1662742.hstgr.cloud/avroleva/downloads/` renders with the size/date line and
   `curl -sI …/downloads/tech.apk` answers 200 with `content-type: application/vnd.android.package-archive`.
4. Real-phone pass: install from the page (note every OS prompt for the Bulgarian instructions),
   enroll by scanning the office QR (server must prefill to `https://srv1662742.hstgr.cloud/avroleva`),
   Today with the published plan, a visit with two photos offline (airplane mode) → outbox drains
   on reconnect → the office sees the visit and photos, `plan.stop` and `job.event` push after a
   cold start with no network, GPS capture when the tenant feature is on, the 401 → re-enroll path
   (revoke the session from the office).
5. Optional: publish `assetlinks.json` at the host root (nginx `location = /.well-known/assetlinks.json`)
   with the SHA-256 above so the QR link opens the app directly.
6. Keep the keystore backup rule (§4) in the ops checklist; record where the backup lives.
