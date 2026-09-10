// Builds the web assets for the Capacitor shell: base "/", VITE_NATIVE=1, output in dist-native
// (capacitor.config.ts webDir). The PWA build in dist/ (served at /tech/) is untouched.
//
//   npm run build:native                         -> server https://srv1662742.hstgr.cloud/avroleva
//   VITE_DEFAULT_API_ORIGIN=https://x/y npm run build:native
//
// The server is only the default: the technician can change it on the Enroll screen.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

export const DEFAULT_API_ORIGIN = 'https://srv1662742.hstgr.cloud/avroleva'

const env = {
  ...process.env,
  VITE_NATIVE: '1',
  VITE_BASE: '/',
  VITE_DEFAULT_API_ORIGIN: process.env.VITE_DEFAULT_API_ORIGIN || DEFAULT_API_ORIGIN,
}
delete env.VITE_TECH_BASE

console.log(`[build:native] server default ${env.VITE_DEFAULT_API_ORIGIN} -> dist-native/`)
const r = spawnSync('npx', ['vite', 'build'], { cwd: root, env, stdio: 'inherit', shell: true })
process.exit(r.status ?? 1)
