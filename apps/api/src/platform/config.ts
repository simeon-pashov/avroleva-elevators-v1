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
  EMAIL_PROVIDER: z.enum(['console', 'smtp']).default('console'),
  /** smtp://user:pass@host:587 or smtps://…; used when EMAIL_PROVIDER=smtp. */
  SMTP_URL: z.string().optional(),
  /** From header of outgoing e-mail (the tenant's name is prepended as display name). */
  EMAIL_FROM: z.string().default('noreply@avroleva.local'),
  SMS_PROVIDER: z.enum(['console', 'http']).default('console'),
  /** Generic HTTP SMS gateway: POST {to, text} as JSON with `Authorization: Bearer SMS_HTTP_TOKEN`. */
  SMS_HTTP_URL: z.string().optional(),
  SMS_HTTP_TOKEN: z.string().optional(),
  /** Payment provider stubs (ADR 0001 section 3): keys are validated, the adapters stay disabled until integrated. */
  IRIS_API_KEY: z.string().min(8).optional(),
  IRIS_WEBHOOK_SECRET: z.string().min(8).optional(),
  STRIPE_SECRET_KEY: z
    .string()
    .regex(/^(sk|rk)_/, 'must start with sk_ or rk_')
    .optional(),
  STRIPE_WEBHOOK_SECRET: z
    .string()
    .regex(/^whsec_/, 'must start with whsec_')
    .optional(),
  /** api | worker | all (ARCHITECTURE section 6). `all` runs the pg-boss worker inside the API process. */
  ROLE: z.enum(['api', 'worker', 'all']).default('all'),
  /** false = no pg-boss at all: events are delivered in-process, crons do not run (tests). */
  WORKER_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === undefined || v === '' || v === 'true' || v === '1'),
  /** Schedule cron jobs (Europe/Sofia). Off = only queues (event delivery, exports) run. */
  CRON_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === undefined || v === '' || v === 'true' || v === '1'),
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
