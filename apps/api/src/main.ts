import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { config } from './platform/config.js'
import { logger } from './platform/logger.js'
import { disconnectDb } from './platform/db/prisma.js'
import { createApp } from './app.js'
import { registerSubscribers } from './subscribers.js'

const here = dirname(fileURLToPath(import.meta.url))
const officeDist = config.OFFICE_DIST ?? resolve(here, '../../office/dist')

registerSubscribers()
const app = createApp({ officeDist })

const server = app.listen(config.PORT, () => {
  logger.info(
    {
      port: config.PORT,
      basePath: config.BASE_PATH,
      env: config.NODE_ENV,
      geocoder: config.GEOCODER,
    },
    `Avroleva API listening on http://localhost:${config.PORT}/api/v1/health`,
  )
})

async function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down')
  server.close(async () => {
    await disconnectDb()
    process.exit(0)
  })
  setTimeout(() => process.exit(1), 10_000).unref()
}
process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
