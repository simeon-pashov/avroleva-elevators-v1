import { config as loadDotenv } from 'dotenv'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { z } from 'zod'

// One .env for the monorepo at the repo root (…/apps/api/src/platform -> ../../../../.env).
const here = dirname(fileURLToPath(import.meta.url))
loadDotenv({ path: resolve(here, '../../../../.env'), quiet: true })
loadDotenv({ path: resolve(here, '../../.env'), quiet: true, override: true })

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1')

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  TEST_DATABASE_URL: z.string().optional(),
  PORT: z.coerce.number().int().positive().default(3005),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  BASE_PATH: z
    .string()
    .default('/')
    .transform((p) => {
      let s = p.trim()
      if (!s.startsWith('/')) s = '/' + s
      if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1)
      return s
    }),
  PUBLIC_BASE_URL: z.string().default('http://localhost:3005'),
  COOKIE_SECURE: bool,
  SESSION_SECRET: z.string().min(8),
  ADMIN_USERNAME: z.string().min(3).default('admin'),
  ADMIN_PASSWORD: z.string().min(8).optional(),
  SEED_DEMO: bool,
  GEOCODER: z.enum(['nominatim', 'stub']).default('nominatim'),
  NOMINATIM_URL: z.string().default('https://nominatim.openstreetmap.org'),
  EMAIL_PROVIDER: z.enum(['console']).default('console'),
  SMS_PROVIDER: z.enum(['console']).default('console'),
  OFFICE_DIST: z.string().optional(),
  /** Built technician app (apps/tech/dist), served at /tech/. */
  TECH_DIST: z.string().optional(),
  /** Root of the local FileStorage adapter (attachments). Relative paths resolve from the cwd. */
  DATA_DIR: z.string().default('./data'),
  /** Lowest technician-app version still accepted; sent as X-Min-Client-Version on every API response. */
  MIN_CLIENT_VERSION: z.string().default('0.4.0'),
})

export type Config = z.infer<typeof schema>

/** Fail-fast: an invalid environment refuses to start (ARCHITECTURE section 7). */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env)
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`)
    throw new Error(`Invalid configuration:\n${lines.join('\n')}`)
  }
  const cfg = parsed.data
  if (cfg.NODE_ENV === 'production' && cfg.SESSION_SECRET === 'dev-secret-change-me') {
    throw new Error('Invalid configuration: SESSION_SECRET must be changed in production')
  }
  return cfg
}

export const config = loadConfig()
