import { prismaBase } from '../db/prisma.js'
import { logger } from '../logger.js'
import { clock } from '../clock.js'

/**
 * Job registry (ARCHITECTURE D9): every scheduled or queued job is declared once with its name,
 * optional cron (Europe/Sofia) and handler. The worker (apps/api/src/worker.ts) registers them
 * with pg-boss; tests and the admin "run now" button call `runJob` directly. Every run is
 * bookkept in `job_run` (last start / finish / status / error) for /health and /admin.
 */
export interface JobDefinition<TData = Record<string, unknown>> {
  name: string
  /** 5-field cron in Europe/Sofia; omitted = queue job only (sent with `enqueue`). */
  cron?: string
  /** Human summary for the handoff / admin page. */
  description: string
  handler: (data: TData) => Promise<unknown>
  /** pg-boss retry policy for queue jobs (crons run once per tick and are catch-up idempotent). */
  retryLimit?: number
  retryDelaySeconds?: number
  /** Seconds the handler may run before pg-boss considers it expired (default 15 min). */
  expireInSeconds?: number
}

const jobs = new Map<string, JobDefinition<never>>()

export function defineJob<TData = Record<string, unknown>>(def: JobDefinition<TData>): void {
  if (jobs.has(def.name)) throw new Error(`job ${def.name} is defined twice`)
  jobs.set(def.name, def as unknown as JobDefinition<never>)
}

export function listJobs(): JobDefinition<never>[] {
  return [...jobs.values()]
}

export function getJob(name: string): JobDefinition<never> | undefined {
  return jobs.get(name)
}

/** Runs a job handler in-process with bookkeeping; rethrows so pg-boss can retry queue jobs. */
export async function runJob(name: string, data: Record<string, unknown> = {}): Promise<unknown> {
  const def = jobs.get(name)
  if (!def) throw new Error(`unknown job ${name}`)
  const startedAt = clock.now()
  await bookkeep(name, def.cron ?? null, { lastStartedAt: startedAt, lastStatus: 'running' })
  try {
    const result = await (def.handler as (d: Record<string, unknown>) => Promise<unknown>)(data)
    const finishedAt = clock.now()
    await bookkeep(name, def.cron ?? null, {
      lastFinishedAt: finishedAt,
      lastStatus: 'ok',
      lastError: null,
      lastDurationMs: finishedAt.getTime() - startedAt.getTime(),
      lastResult: summarise(result),
    })
    return result
  } catch (err) {
    const finishedAt = clock.now()
    logger.error({ err, job: name }, 'job failed')
    await bookkeep(name, def.cron ?? null, {
      lastFinishedAt: finishedAt,
      lastStatus: 'failed',
      lastError: String((err as Error)?.message ?? err).slice(0, 2000),
      lastDurationMs: finishedAt.getTime() - startedAt.getTime(),
    })
    throw err
  }
}

function summarise(result: unknown): object | undefined {
  if (result === undefined || result === null) return undefined
  if (typeof result === 'object') return result as object
  return { value: result }
}

async function bookkeep(
  name: string,
  cron: string | null,
  data: {
    lastStartedAt?: Date
    lastFinishedAt?: Date
    lastStatus?: string
    lastError?: string | null
    lastDurationMs?: number
    lastResult?: object
  },
): Promise<void> {
  try {
    await prismaBase.jobRun.upsert({
      where: { name },
      create: { name, cron, ...data },
      update: { cron, ...data },
    })
  } catch (err) {
    logger.warn({ err, job: name }, 'job bookkeeping failed')
  }
}

export interface JobRunRow {
  name: string
  cron: string | null
  lastStartedAt: Date | null
  lastFinishedAt: Date | null
  lastStatus: string | null
  lastError: string | null
  lastDurationMs: number | null
}

/** Registry merged with the `job_run` table (jobs that never ran still appear). */
export async function jobStatuses(): Promise<JobRunRow[]> {
  const rows = await prismaBase.jobRun.findMany()
  const byName = new Map(rows.map((r) => [r.name, r]))
  return listJobs().map((j) => {
    const r = byName.get(j.name)
    return {
      name: j.name,
      cron: j.cron ?? null,
      lastStartedAt: r?.lastStartedAt ?? null,
      lastFinishedAt: r?.lastFinishedAt ?? null,
      lastStatus: r?.lastStatus ?? null,
      lastError: r?.lastError ?? null,
      lastDurationMs: r?.lastDurationMs ?? null,
    }
  })
}
