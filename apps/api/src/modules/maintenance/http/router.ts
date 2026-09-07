import { Router } from 'express'
import { dueQuery, rescheduleBody } from '@avroleva/contracts'
import { ctxOf, requireAuth, requireRole } from '../../../platform/http/ctx.js'
import { parseBody, parseId, parseQuery } from '../../../platform/http/validate.js'
import * as service from '../service.js'

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
