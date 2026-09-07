import { config } from '../src/platform/config.js'
import { logger } from '../src/platform/logger.js'
import { disconnectDb } from '../src/platform/db/prisma.js'
import { ensurePlatformAdmin } from '../src/modules/tenancy/index.js'
import { seedDemoTenant } from './seed/demo.js'

/**
 * Idempotent seed: platform admin from ADMIN_USERNAME/ADMIN_PASSWORD (always, when set) and the
 * demo tenant when SEED_DEMO=true. Safe to run repeatedly (upserts keyed by natural keys).
 */
async function main() {
  if (config.ADMIN_PASSWORD) {
    await ensurePlatformAdmin(config.ADMIN_USERNAME, config.ADMIN_PASSWORD)
    logger.info({ username: config.ADMIN_USERNAME }, 'platform admin ensured')
  } else {
    logger.warn('ADMIN_PASSWORD not set - platform admin not seeded')
  }
  if (config.SEED_DEMO) {
    const summary = await seedDemoTenant()
    logger.info(summary, 'demo tenant seeded')
  } else {
    logger.info('SEED_DEMO is not true - demo tenant skipped')
  }
}

main()
  .catch((err) => {
    logger.error({ err }, 'seed failed')
    process.exitCode = 1
  })
  .finally(() => disconnectDb())
