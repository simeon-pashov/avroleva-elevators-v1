import { Router } from 'express'
import {
  checklistActiveQuery,
  createTechnicianPairBody,
  dayBoardQuery,
  dayPlansMineQuery,
  dueQuery,
  generateDayPlansBody,
  moveStopBody,
  publishDayPlansBody,
  rescheduleBody,
  setStopStatusBody,
  updateDayPlanBody,
  updateTechnicianPairBody,
} from '@avroleva/contracts'
import { ctxOf, requireAuth, requireRole } from '../../../platform/http/ctx.js'
import { parseBody, parseId, parseQuery } from '../../../platform/http/validate.js'
import * as service from '../service.js'
import * as checklists from '../service/checklists.js'
import * as pairs from '../service/pairs.js'
import * as plans from '../service/plans.js'

export const maintenanceRouter = Router()
maintenanceRouter.use(requireAuth)

const office = requireRole('owner', 'office')
const owner = requireRole('owner')

// ---- technician pairs (екипи, step 9): reads for everyone, writes for the owner
maintenanceRouter.get('/technician-pairs', async (req, res) => {
  res.json({ items: await pairs.list(ctxOf(req)) })
})
maintenanceRouter.post('/technician-pairs', owner, async (req, res) => {
  res.status(201).json(await pairs.create(ctxOf(req), parseBody(createTechnicianPairBody, req)))
})
maintenanceRouter.patch('/technician-pairs/:id', owner, async (req, res) => {
  res.json(await pairs.update(ctxOf(req), parseId(req), parseBody(updateTechnicianPairBody, req)))
})
maintenanceRouter.delete('/technician-pairs/:id', owner, async (req, res) => {
  await pairs.archive(ctxOf(req), parseId(req))
  res.status(204).end()
})

// ---- day plans (План за деня, step 9)
maintenanceRouter.get('/day-plans', async (req, res) => {
  res.json(await plans.board(ctxOf(req), parseQuery(dayBoardQuery, req)))
})
maintenanceRouter.get('/day-plans/mine', async (req, res) => {
  const q = parseQuery(dayPlansMineQuery, req)
  res.json({ items: await plans.mine(ctxOf(req), q.date) })
})
maintenanceRouter.post('/day-plans/generate', office, async (req, res) => {
  res.json(await plans.generate(ctxOf(req), parseBody(generateDayPlansBody, req)))
})
maintenanceRouter.post('/day-plans/publish', office, async (req, res) => {
  res.json(await plans.publish(ctxOf(req), parseBody(publishDayPlansBody, req)))
})
maintenanceRouter.get('/day-plans/:id', async (req, res) => {
  res.json(await plans.get(ctxOf(req), parseId(req)))
})
maintenanceRouter.patch('/day-plans/:id', office, async (req, res) => {
  res.json(await plans.update(ctxOf(req), parseId(req), parseBody(updateDayPlanBody, req)))
})
maintenanceRouter.post('/day-plans/:id/move-stop', office, async (req, res) => {
  res.json(await plans.moveStop(ctxOf(req), parseId(req), parseBody(moveStopBody, req)))
})
maintenanceRouter.post('/day-plans/:id/lock', office, async (req, res) => {
  res.json(await plans.setLocked(ctxOf(req), parseId(req), true))
})
maintenanceRouter.post('/day-plans/:id/unlock', office, async (req, res) => {
  res.json(await plans.setLocked(ctxOf(req), parseId(req), false))
})
/** Office roles, or a technician listed in the plan (the service answers 404 otherwise). */
maintenanceRouter.post('/day-plans/:id/stops/:stopId/status', async (req, res) => {
  res.json(
    await plans.setStopStatus(
      ctxOf(req),
      parseId(req),
      parseId(req, 'stopId'),
      parseBody(setStopStatusBody, req),
      req.header('x-client') === 'app' ? 'app' : 'office',
    ),
  )
})

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
