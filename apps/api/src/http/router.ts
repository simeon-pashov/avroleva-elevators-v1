import { Router } from 'express'
import type { HealthDto } from '@avroleva/contracts'
import { prismaBase } from '../platform/db/prisma.js'
import * as tenancy from '../modules/tenancy/index.js'
import { registryRouter } from '../modules/registry/index.js'
import { maintenanceRouter } from '../modules/maintenance/index.js'
import { visitsRouter } from '../modules/visits/index.js'
import { billingRouter } from '../modules/billing/index.js'
import { callbacksRouter } from '../modules/callbacks/index.js'
import { defectsRouter } from '../modules/defects/index.js'
import { calendarRouter } from '../modules/calendar/index.js'
import { reportingRouter } from '../modules/reporting/index.js'
import { attachmentsRouter } from '../modules/documents/index.js'
import { adminRouter } from './admin.js'
import { syncRouter } from './sync.js'

export const APP_VERSION = '0.4.0'

/** `/api/v1` - additive only; breaking changes go to `/api/v2` beside it (ARCHITECTURE A9). */
export const apiV1 = Router()

apiV1.get('/health', async (_req, res) => {
  let db: HealthDto['db'] = 'down'
  try {
    await prismaBase.$queryRaw`SELECT 1`
    db = 'up'
  } catch {
    db = 'down'
  }
  const body: HealthDto = {
    ok: db === 'up',
    db,
    version: APP_VERSION,
    time: new Date().toISOString(),
  }
  res.status(body.ok ? 200 : 503).json(body)
})

// Admin facade first: its guard is path-scoped to /admin, while the tenant routers below
// apply requireAuth at their root and would otherwise swallow /admin/auth/login with a 401.
apiV1.use(adminRouter)
apiV1.use(tenancy.authRouter)
apiV1.use(tenancy.tenantRouter)
apiV1.use(tenancy.usersRouter)
apiV1.use(registryRouter)
apiV1.use(maintenanceRouter)
apiV1.use(visitsRouter)
apiV1.use(billingRouter)
apiV1.use(callbacksRouter)
apiV1.use(defectsRouter)
apiV1.use(calendarRouter)
apiV1.use(reportingRouter)
apiV1.use(attachmentsRouter)
apiV1.use(syncRouter)
