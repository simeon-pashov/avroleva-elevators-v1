// Runs a Gradle task of the Android project with the user-scoped toolchain of
// D:\Code\Avroleva\ANDROID-TOOLCHAIN.md (JDK 17 + Android SDK under %LOCALAPPDATA%). JAVA_HOME /
// ANDROID_HOME from the environment win; the defaults below are the documented install paths.
//
//   node scripts/gradle.mjs assembleRelease      -> android/app/build/outputs/apk/release/app-release.apk
//   node scripts/gradle.mjs assembleDebug        -> android/app/build/outputs/apk/debug/app-debug.apk
//   APK_OUT_DIR=D:\Code\Avroleva\Releases node scripts/gradle.mjs assembleRelease
//     also copies the APK there as avroleva-elevators-tech-<version>.apk (outside the repo).
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const android = join(root, 'android')
const task = process.argv[2] || 'assembleRelease'
const local = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')

const env = {
  ...process.env,
  JAVA_HOME: process.env.JAVA_HOME || join(local, 'Programs', 'jdk-17'),
  ANDROID_HOME: process.env.ANDROID_HOME || join(local, 'Android', 'Sdk'),
}
env.ANDROID_SDK_ROOT = env.ANDROID_HOME
env.PATH = `${join(env.JAVA_HOME, 'bin')}${process.platform === 'win32' ? ';' : ':'}${env.PATH ?? env.Path ?? ''}`

if (!existsSync(join(env.JAVA_HOME, 'bin'))) {
  console.error(`[gradle] JAVA_HOME not found: ${env.JAVA_HOME} (see ANDROID-TOOLCHAIN.md)`)
  process.exit(1)
}
if (!existsSync(android)) {
  console.error('[gradle] android/ missing - run `npx cap add android` first')
  process.exit(1)
}

const wrapper = process.platform === 'win32' ? 'gradlew.bat' : './gradlew'
console.log(`[gradle] ${task} (JAVA_HOME=${env.JAVA_HOME}, ANDROID_HOME=${env.ANDROID_HOME})`)
const r = spawnSync(wrapper, [task, '--no-daemon', '--console=plain'], {
  cwd: android,
  env,
  stdio: 'inherit',
  shell: true,
})
if (r.status !== 0) process.exit(r.status ?? 1)

const variant = /release/i.test(task) ? 'release' : 'debug'
const apk = join(android, 'app', 'build', 'outputs', 'apk', variant, `app-${variant}.apk`)
if (!existsSync(apk)) {
  console.warn(`[gradle] done, but no APK at ${apk}`)
  process.exit(0)
}
const size = (statSync(apk).size / 1024 / 1024).toFixed(1)
console.log(`[gradle] ${apk} (${size} MB)`)

if (process.env.APK_OUT_DIR) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const suffix = variant === 'release' ? '' : '-debug'
  const out = join(process.env.APK_OUT_DIR, `avroleva-elevators-tech-${pkg.version}${suffix}.apk`)
  mkdirSync(process.env.APK_OUT_DIR, { recursive: true })
  copyFileSync(apk, out)
  console.log(`[gradle] copied to ${out}`)
}
