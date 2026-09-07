/**
 * reporting (L4) - dashboard, later monthly PDF and exports. Read-only; may read any module's
 * public queries (and, by the ownership rule, SELECT any table). Owns no table yet.
 */
import { Router } from 'express'
import { ctxOf, requireAuth } from '../../platform/http/ctx.js'
import { dashboard } from './service.js'

export { dashboard }

export const reportingRouter = Router()
reportingRouter.use(requireAuth)
reportingRouter.get('/dashboard', async (req, res) => {
  res.json(await dashboard(ctxOf(req)))
})

export const moduleInfo = { name: 'reporting', layer: 4, status: 'active' } as const
