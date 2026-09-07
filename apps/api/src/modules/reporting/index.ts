/**
 * reporting (L4) - dashboard and the merged deadlines calendar; later monthly PDF and exports.
 * Read-only; may read any module's public queries (and, by the ownership rule, SELECT any table).
 * Owns no table yet.
 */
import { Router } from 'express'
import { calendarQuery } from '@avroleva/contracts'
import { ctxOf, requireAuth } from '../../platform/http/ctx.js'
import { parseQuery } from '../../platform/http/validate.js'
import { calendarFromQuery, calendarItems, dashboard } from './service.js'

export { dashboard, calendarItems }

export const reportingRouter = Router()
reportingRouter.use(requireAuth)
reportingRouter.get('/dashboard', async (req, res) => {
  res.json(await dashboard(ctxOf(req)))
})
reportingRouter.get('/calendar', async (req, res) => {
  res.json(await calendarFromQuery(ctxOf(req), parseQuery(calendarQuery, req)))
})

export const moduleInfo = { name: 'reporting', layer: 4, status: 'active' } as const
