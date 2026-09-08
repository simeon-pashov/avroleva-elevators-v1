import PgBoss from 'pg-boss'
import { config } from '../config.js'
import { logger } from '../logger.js'
import { getJob, runJob } from './registry.js'

/**
 * pg-boss 10 (ARCHITECTURE D8/D9): the same Postgres, schema `pgboss`. One instance per process.
 * - `queueEnabled()` - this process may *send* jobs (API and worker alike; WORKER_ENABLED=true).
 * - `workEnabled()`  - this process also *runs* handlers and crons (ROLE=worker|all).
 * When the queue is disabled (tests, WORKER_ENABLED=false) `enqueue` falls back to running the
 * handler in-process on the next tick, so behaviour stays the same minus persistence/retries.
 */
export const TIMEZONE = 'Europe/Sofia'

let boss: PgBoss | null = null
let starting: Promise<PgBoss> | null = null

export function queueEnabled(): boolean {
  return config.WORKER_ENABLED
}

export function workEnabled(): boolean {
  return config.WORKER_ENABLED && config.ROLE !== 'api'
}

export function getBoss(): PgBoss | null {
  return boss
}

export function bossRunning(): boolean {
  return boss !== null
}

export async function startBoss(): Promise<PgBoss> {
  if (boss) return boss
  if (starting) return starting
  starting = (async () => {
    const url =
      config.NODE_ENV === 'test' && config.TEST_DATABASE_URL
        ? config.TEST_DATABASE_URL
        : config.DATABASE_URL
    const instance = new PgBoss({
      connectionString: url,
      schema: 'pgboss',
      max: 4,
      // Housekeeping tuned for a one-VPS deployment: archive completed jobs after a day, delete after 7.
      archiveCompletedAfterSeconds: 24 * 60 * 60,
      deleteAfterDays: 7,
      // Supervision (maintenance, archiving, cron clock) only where handlers run.
      supervise: workEnabled(),
      schedule: workEnabled() && config.CRON_ENABLED,
    })
    instance.on('error', (err) => logger.error({ err }, 'pg-boss error'))
    await instance.start()
    boss = instance
    logger.info({ role: config.ROLE, work: workEnabled() }, 'pg-boss started')
    return instance
  })()
  try {
    return await starting
  } finally {
    starting = null
  }
}

export async function stopBoss(): Promise<void> {
  if (!boss) return
  const b = boss
  boss = null
  await b.stop({ graceful: true, timeout: 10_000, wait: true })
}

export interface EnqueueOptions {
  /** Same key twice while the first is still queued/active = one job (pg-boss singletonKey). */
  singletonKey?: string
  startAfterSeconds?: number
}

/**
 * Sends a job to pg-boss; with the queue disabled the handler runs in-process on the next tick
 * (errors are logged, never propagated - a command must not depend on a job, rule 5).
 */
export async function enqueue(
  name: string,
  data: Record<string, unknown> = {},
  opts: EnqueueOptions = {},
): Promise<string | null> {
  const def = getJob(name)
  if (!def) throw new Error(`unknown job ${name}`)
  if (boss) {
    return boss.send(name, data, {
      retryLimit: def.retryLimit ?? 5,
      retryDelay: def.retryDelaySeconds ?? 10,
      retryBackoff: true,
      expireInSeconds: def.expireInSeconds ?? 15 * 60,
      ...(opts.singletonKey ? { singletonKey: opts.singletonKey } : {}),
      ...(opts.startAfterSeconds ? { startAfter: opts.startAfterSeconds } : {}),
    })
  }
  setImmediate(() => {
    runJob(name, data).catch(() => {
      /* logged by runJob */
    })
  })
  return null
}

/** Jobs waiting (created + retry) across every queue, for /health. */
export async function queuedCount(): Promise<number | null> {
  if (!boss) return null
  try {
    const names = (await boss.getQueues()).map((q) => q.name)
    let total = 0
    for (const n of names) total += await boss.getQueueSize(n)
    return total
  } catch {
    return null
  }
}
