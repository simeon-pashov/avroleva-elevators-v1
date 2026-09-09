export * from './common.js'
export * from './enums.js'
export * from './tenancy.js'
export * from './registry.js'
export * from './maintenance.js'
export * from './visits.js'
export * from './billing.js'
export * from './callbacks.js'
export * from './defects.js'
export * from './calendar.js'
export * from './reporting.js'
export * from './checklists.js'
export * from './documents.js'
export * from './sync.js'
export * from './notifications.js'
export * from './exports.js'
export * from './iban.js'

export interface JobStatusDto {
  name: string
  cron: string | null
  lastStartedAt: string | null
  lastFinishedAt: string | null
  lastStatus: 'ok' | 'failed' | 'running' | null
  lastError: string | null
  lastDurationMs: number | null
}

export interface HealthDto {
  ok: boolean
  db: 'up' | 'down'
  version: string
  time: string
  worker: {
    enabled: boolean
    running: boolean
    /** pg-boss jobs waiting (created + retry) across all queues, when the worker runs. */
    queued: number | null
    jobs: JobStatusDto[]
  }
}
