import { config } from './platform/config.js'
import { logger } from './platform/logger.js'
import { TIMEZONE, queueEnabled, startBoss, stopBoss, workEnabled } from './platform/jobs/boss.js'
import { listJobs, runJob } from './platform/jobs/registry.js'
import { registerJobs } from './jobs.js'

/**
 * Worker bootstrap (ARCHITECTURE section 6, D9). `ROLE=all` (default) runs it inside the API
 * process; `ROLE=worker` runs only this (see worker-main.ts); `ROLE=api` starts pg-boss for
 * *sending* jobs but runs no handlers. `WORKER_ENABLED=false` skips pg-boss entirely (tests):
 * events and queued jobs then run in-process, crons never fire.
 */
let registered = false

export function ensureJobsRegistered(): void {
  if (registered) return
  registerJobs()
  registered = true
}

export async function startWorker(): Promise<void> {
  ensureJobsRegistered()
  if (!queueEnabled()) {
    logger.info('pg-boss disabled (WORKER_ENABLED=false): in-process fallback for events and jobs')
    return
  }
  const boss = await startBoss()
  for (const job of listJobs()) {
    await boss.createQueue(job.name, {
      name: job.name,
      retryLimit: job.retryLimit ?? 5,
      retryDelay: job.retryDelaySeconds ?? 10,
      retryBackoff: true,
      expireInSeconds: job.expireInSeconds ?? 15 * 60,
    })
    if (!workEnabled()) continue
    await boss.work(
      job.name,
      { batchSize: 1, pollingIntervalSeconds: job.cron ? 5 : 2 },
      async (jobs) => {
        for (const j of jobs) await runJob(job.name, (j.data ?? {}) as Record<string, unknown>)
      },
    )
    if (job.cron && config.CRON_ENABLED) {
      await boss.schedule(
        job.name,
        job.cron,
        {},
        { tz: TIMEZONE, singletonKey: job.name, singletonSeconds: 55 },
      )
    } else if (job.cron) {
      await boss.unschedule(job.name).catch(() => undefined)
    }
  }
  logger.info(
    { work: workEnabled(), cron: config.CRON_ENABLED, jobs: listJobs().map((j) => j.name) },
    'worker ready',
  )
}

export async function stopWorker(): Promise<void> {
  await stopBoss()
}
