import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { config } from './platform/config.js'
import { logger } from './platform/logger.js'
import { disconnectDb } from './platform/db/prisma.js'
import { createApp } from './app.js'
import { registerSubscribers } from './subscribers.js'
import { startWorker, stopWorker } from './worker.js'

const here = dirname(fileURLToPath(import.meta.url))
const officeDist = config.OFFICE_DIST ?? resolve(here, '../../office/dist')
const techDist = config.TECH_DIST ?? resolve(here, '../../tech/dist')

/**
 * Process entry. ROLE=all (default): HTTP + worker in one process. ROLE=api: HTTP only (pg-boss
 * is still started so the API can enqueue jobs). ROLE=worker: no HTTP, handlers and crons only -
 * `node dist/main.js` with ROLE=worker is the "run the worker separately" command.
 */
registerSubscribers()

const app = config.ROLE === 'worker' ? null : createApp({ officeDist, techDist })
const server = app
  ? app.listen(config.PORT, () => {
      logger.info(
        {
          port: config.PORT,
          basePath: config.BASE_PATH,
          env: config.NODE_ENV,
          role: config.ROLE,
          geocoder: config.GEOCODER,
          email: config.EMAIL_PROVIDER,
          sms: config.SMS_PROVIDER,
        },
        `Avroleva API listening on http://localhost:${config.PORT}/api/v1/health`,
      )
    })
  : null

startWorker().catch((err) => {
  logger.error({ err }, 'worker failed to start')
  if (config.ROLE === 'worker') process.exit(1)
})

async function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down')
  const finish = async () => {
    await stopWorker().catch(() => undefined)
    await disconnectDb()
    process.exit(0)
  }
  if (server) server.close(() => void finish())
  else void finish()
  setTimeout(() => process.exit(1), 15_000).unref()
}
process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
