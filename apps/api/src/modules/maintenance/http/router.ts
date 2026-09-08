import { Router } from 'express'
import { checklistActiveQuery, dueQuery, rescheduleBody } from '@avroleva/contracts'
import { ctxOf, requireAuth, requireRole } from '../../../platform/http/ctx.js'
import { parseBody, parseId, parseQuery } from '../../../platform/http/validate.js'
import * as service from '../service.js'
import * as checklists from '../service/checklists.js'

export const maintenanceRouter = Router()
maintenanceRouter.use(requireAuth)

maintenanceRouter.get('/maintenance/due', async (req, res) => {
  const q = parseQuery(dueQuery, req)
  res.json(await service.dueBoard(ctxOf(req), q.date))
})

maintenanceRouter.post(
  '/elevators/:id/reschedule',
  requireRole('owner', 'office'),
  async (req, res) => {
    const body = parseBody(rescheduleBody, req)
    res.json(await service.reschedule(ctxOf(req), parseId(req), body.toDate))
  },
)

/** Checklist templates as data: the tenant's active set, and the one that applies to a lift. */
maintenanceRouter.get('/checklists', async (req, res) => {
  res.json({ items: await checklists.listActive(ctxOf(req).tenantId) })
})

maintenanceRouter.get('/checklists/active', async (req, res) => {
  const q = parseQuery(checklistActiveQuery, req)
  res.json(await checklists.activeForElevator(ctxOf(req), q.elevatorId, q.key))
})
