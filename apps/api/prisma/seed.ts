import { config } from '../src/platform/config.js'
import { logger } from '../src/platform/logger.js'
import { disconnectDb } from '../src/platform/db/prisma.js'
import { ensurePlatformAdmin } from '../src/modules/tenancy/index.js'
import { checklists } from '../src/modules/maintenance/index.js'
import * as notifications from '../src/modules/notifications/index.js'
import { events } from '../src/platform/events/bus.js'
import { SUBSCRIPTIONS } from '../src/subscribers.js'
import { seedDemoTenant } from './seed/demo.js'

/**
 * Idempotent seed: platform admin from ADMIN_USERNAME/ADMIN_PASSWORD (always, when set) and the
 * demo tenant when SEED_DEMO=true. Safe to run repeatedly (upserts keyed by natural keys).
 */
async function main() {
  // System checklist templates (tenantId NULL) from packages/domain-data - every deployment.
  const templates = await checklists.ensureSystemTemplates()
  logger.info({ templates }, 'system checklist templates ensured')
  // System notification templates (tenantId NULL) from packages/domain-data - every deployment.
  const notificationTemplates = await notifications.ensureSystemTemplates()
  logger.info(notificationTemplates, 'system notification templates ensured')
  if (config.ADMIN_PASSWORD) {
    await ensurePlatformAdmin(config.ADMIN_USERNAME, config.ADMIN_PASSWORD)
    logger.info({ username: config.ADMIN_USERNAME }, 'platform admin ensured')
  } else {
    logger.warn('ADMIN_PASSWORD not set - platform admin not seeded')
  }
  if (config.SEED_DEMO) {
    const { counts, tenantId } = await seedDemoTenant()
    logger.info(counts, 'demo tenant seeded')
    // The seed writes months of history through the same services as the app, so their domain
    // events exist (audit, dedupe) but must never be delivered as news: without this, the outbox
    // sweep would flood every inbox with "issued invoice" rows the moment the API starts.
    const acknowledged = await events.acknowledge(tenantId, SUBSCRIPTIONS)
    logger.info({ acknowledged }, 'seed events acknowledged (not delivered)')
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
