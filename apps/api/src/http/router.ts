import { Router } from 'express'
import type { HealthDto } from '@avroleva/contracts'
import { prismaBase } from '../platform/db/prisma.js'
import * as tenancy from '../modules/tenancy/index.js'
import { registryRouter } from '../modules/registry/index.js'
import { adminRouter } from './admin.js'

export const APP_VERSION = '0.1.0'

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

apiV1.use(tenancy.authRouter)
apiV1.use(tenancy.tenantRouter)
apiV1.use(tenancy.usersRouter)
apiV1.use(registryRouter)
apiV1.use(adminRouter)
