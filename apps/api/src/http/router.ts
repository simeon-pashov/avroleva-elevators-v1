import { Router } from 'express'
import { health } from './health.js'
import * as tenancy from '../modules/tenancy/index.js'
import { registryRouter } from '../modules/registry/index.js'
import { maintenanceRouter } from '../modules/maintenance/index.js'
import { visitsRouter } from '../modules/visits/index.js'
import { billingRouter } from '../modules/billing/index.js'
import { callbacksRouter } from '../modules/callbacks/index.js'
import { defectsRouter } from '../modules/defects/index.js'
import { calendarRouter } from '../modules/calendar/index.js'
import { exportsRouter, reportingRouter, reportsRouter } from '../modules/reporting/index.js'
import { attachmentsRouter } from '../modules/documents/index.js'
import { notificationsRouter } from '../modules/notifications/index.js'
import { adminRouter } from './admin.js'
import { syncRouter } from './sync.js'

export { APP_VERSION, health } from './health.js'

/** `/api/v1` - additive only; breaking changes go to `/api/v2` beside it (ARCHITECTURE A9). */
export const apiV1 = Router()

apiV1.get('/health', async (_req, res) => {
  const body = await health()
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
apiV1.use(exportsRouter)
apiV1.use(reportsRouter)
apiV1.use(notificationsRouter)
apiV1.use(attachmentsRouter)
apiV1.use(syncRouter)
