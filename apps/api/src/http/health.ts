import type { HealthDto } from '@avroleva/contracts'
import { prismaBase } from '../platform/db/prisma.js'
import { bossRunning, queueEnabled, queuedCount, workEnabled } from '../platform/jobs/boss.js'
import { jobStatuses } from '../platform/jobs/registry.js'

export const APP_VERSION = '0.5.0'

/** Health (ARCHITECTURE section 6): db, worker status, last run per cron, queue depth. */
export async function health(): Promise<HealthDto> {
  let db: HealthDto['db'] = 'down'
  try {
    await prismaBase.$queryRaw`SELECT 1`
    db = 'up'
  } catch {
    db = 'down'
  }
  let jobs: HealthDto['worker']['jobs'] = []
  if (db === 'up') {
    try {
      jobs = (await jobStatuses()).map((j) => ({
        name: j.name,
        cron: j.cron,
        lastStartedAt: j.lastStartedAt?.toISOString() ?? null,
        lastFinishedAt: j.lastFinishedAt?.toISOString() ?? null,
        lastStatus: (j.lastStatus as 'ok' | 'failed' | 'running' | null) ?? null,
        lastError: j.lastError,
        lastDurationMs: j.lastDurationMs,
      }))
    } catch {
      jobs = []
    }
  }
  return {
    ok: db === 'up',
    db,
    version: APP_VERSION,
    time: new Date().toISOString(),
    worker: {
      enabled: queueEnabled() && workEnabled(),
      running: bossRunning(),
      queued: await queuedCount(),
      jobs,
    },
  }
}
