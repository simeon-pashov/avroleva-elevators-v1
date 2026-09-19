# Android release of the technician app (Capacitor)

The technician PWA (`apps/tech`) also ships as a native Android app: the same React build wrapped
by Capacitor 7 (`apps/tech/android`, Gradle project committed as Capacitor recommends). The APK is
sideloaded (no Play Store account yet) from the server's `/downloads/` page. This document is the
release procedure and the keystore custody rule. Toolchain: `D:\Code\Avroleva\Avroleva Elevators\ANDROID-TOOLCHAIN.md`
(JDK 17 + Android SDK, user-scoped, no admin).

## 1. What is where

| Thing                                            | Path                                                                                                            |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Capacitor config                                 | `apps/tech/capacitor.config.ts` (appId `bg.avroleva.elevators.tech`, name "Avroleva Elevators", webDir `dist-native`) |
| Android project (committed)                      | `apps/tech/android/` — `app/build.gradle` (version + signing), `app/src/main/AndroidManifest.xml` (permissions, deep links) |
| Native web build (git-ignored)                   | `apps/tech/dist-native/` — `npm run build:native` (base `/`, `VITE_NATIVE=1`, default server baked in)          |
| Icon / splash sources                            | `apps/tech/assets/*.svg` → `npm run android:assets` renders PNGs and generates all densities                     |
| Release keystore (**never in git**)              | `%USERPROFILE%\.avroleva\android-release.jks`, alias `avroleva`                                                 |
| Keystore password (**never in git**)             | `%USERPROFILE%\.avroleva\android-keystore.txt` (ACL: owner only)                                                |
| Local signing config (git-ignored)               | `apps/tech/android/keystore.properties` (template: `keystore.properties.example`)                               |
| Built APKs                                       | `apps/tech/android/app/build/outputs/apk/{release,debug}/app-*.apk` (git-ignored)                               |
| Release copies                                   | `D:\Code\Avroleva\Avroleva Elevators\Releases\avroleva-elevators-tech-<version>.apk` (outside the repo)                            |
| Server copy                                      | VPS `DATA_DIR/releases/tech.apk` → served at `https://srv1662742.hstgr.cloud/avroleva/elevators-v1/downloads/tech.apk`      |

## 2. Keystore custody — read this first

The APK is signed with `android-release.jks`. Android identifies an app by **package name + signing
certificate**. If the keystore (or its password) is lost:

- no future build can be installed _over_ the existing installs — every phone must uninstall
  (losing any unsent records on it) and install the new app as a stranger;
- a Play Store listing, if one is ever created with this key, cannot be updated — a new app identity
  is needed.

So: keep **both** files backed up outside the laptop (password manager entry with the `.jks` as an
attachment, or the encrypted off-site backup), never commit them, never paste the password in chat or
in a ticket. The certificate is valid until 2054. Certificate SHA-256 (also needed for App Links):
run `keytool -list -v -keystore %USERPROFILE%\.avroleva\android-release.jks` and read the line
`SHA256:`; the value is recorded in `HANDOFF-STEP10.md`.

Debug builds use the Android debug keystore (`%USERPROFILE%\.android\debug.keystore`, auto-created);
a debug APK cannot be installed over a release one and vice versa.

## 3. Rebuild the APK (developer laptop)

Prerequisites once: `npm ci` at the repo root (installs Capacitor + plugins), toolchain per
`ANDROID-TOOLCHAIN.md`, `apps/tech/android/keystore.properties` copied from the example and filled
in from `android-keystore.txt`. **Gradle must run on a JDK 21** (Capacitor 7.6 compiles with
`sourceCompatibility 21`; JDK 17 fails with `invalid source release: 21`): `scripts/gradle.mjs`
picks one from `JAVA_HOME_21`, `%LOCALAPPDATA%\Programs\jdk-21`, the JDKs Gradle provisions into
`~/.gradle/jdks` (Foojay resolver in `android/settings.gradle`, downloads Temurin 21 on the first
build) or a 21+ `JAVA_HOME`. `ANDROID_HOME` falls back to the documented SDK path.

```powershell
cd "D:\Code\Avroleva\Avroleva Elevators\Elevator Business Site Code"
npm run build:packages                       # contracts + i18n
cd apps\tech
# 1. bump the version in apps/tech/package.json (versionName = this; versionCode = M*10000+m*100+p)
npm run android:release                      # = build:native -> cap sync android -> gradlew assembleRelease
#    -> android\app\build\outputs\apk\release\app-release.apk
npm run android:debug                        # optional debug APK (debug keystore)
```

`build:native` bakes the default server `https://srv1662742.hstgr.cloud/avroleva/elevators-v1`
(`VITE_DEFAULT_API_ORIGIN` overrides it: `set VITE_DEFAULT_API_ORIGIN=https://x/y` before the build).
The technician can change the server at runtime on the Enroll screen or in Settings, so one APK
works against any deployment.

Copy to the release folder (outside the repo; `APK_OUT_DIR` makes `gradle.mjs` do it):

```powershell
$env:APK_OUT_DIR = 'D:\Code\Avroleva\Avroleva Elevators\Releases'
node scripts\gradle.mjs assembleRelease     # also copies avroleva-elevators-tech-<version>.apk there
```

Verify the signature and the contents before shipping:

```powershell
$bt = "$env:LOCALAPPDATA\Android\Sdk\build-tools\35.0.0"
& "$bt\apksigner.bat" verify --print-certs android\app\build\outputs\apk\release\app-release.apk
& "$bt\aapt2.exe" dump badging android\app\build\outputs\apk\release\app-release.apk | Select-String "package|application-label|sdkVersion"
```

Expected: `Verified using v2 scheme (APK Signature Scheme v2): true` (v1/v3 are off for minSdk 26 — normal), the SHA-256 from §2, `package: name='bg.avroleva.elevators.tech' versionCode='600' versionName='0.6.0'`, `minSdkVersion:'26'`, `targetSdkVersion:'35'`.

## 4. Ship it (part of the deploy, step 11)

The server never builds the APK; it serves whatever file sits at `DATA_DIR/releases/tech.apk` on
the `avroleva_data` volume (`/data` inside the container).

```powershell
# from the laptop
scp "D:\Code\Avroleva\Avroleva Elevators\Releases\avroleva-elevators-tech-0.6.0.apk" root@187.127.84.59:/tmp/tech.apk
ssh root@187.127.84.59 "docker run --rm -v avroleva_avroleva_data:/d -v /tmp:/s:ro alpine sh -c 'mkdir -p /d/releases && cp /s/tech.apk /d/releases/tech.apk' && rm /tmp/tech.apk"
# check
curl -sI https://srv1662742.hstgr.cloud/avroleva/elevators-v1/downloads/tech.apk | findstr /i "200 content-type content-length"
```

`https://srv1662742.hstgr.cloud/avroleva/elevators-v1/downloads/` is the Bulgarian install page with a QR of the
APK URL; the office reaches it from **Потребители → "Изтегли приложението за Android"**. Keep
`MIN_CLIENT_VERSION` in the VPS `.env` at or below the version you ship (the API refuses older
clients with a forced-update screen).

## 5. Deep links

- `avroleva-elevators://enroll?server=<origin[/base]>&token=<code>` — custom scheme, always opens
  the app (intent filter in the manifest).
- `https://srv1662742.hstgr.cloud/avroleva/elevators-v1/tech/?enroll=<code>` — the office QR / e-mail link. The
  app parses the server from everything before `/tech/`. Android 12+ opens the app automatically
  only for **verified** App Links: publish
  `https://srv1662742.hstgr.cloud/.well-known/assetlinks.json` (host root, not under `/avroleva/elevators-v1/`)
  with `package_name: bg.avroleva.elevators.tech` and the SHA-256 of §2; until then the link opens
  the PWA in the browser and the app can be chosen under _App info → Open by default_.

## 6. Versioning rules

- `apps/tech/package.json` `version` is the single source: `APP_VERSION` (sent as
  `X-Client-Version`), Android `versionName`, `versionCode` (`0.6.0 → 600`). Bump it for every APK.
- The API's `MIN_CLIENT_VERSION` (env) is the oldest build still accepted.
- A new APK with a **different** certificate cannot be installed over the old one — see §2.
