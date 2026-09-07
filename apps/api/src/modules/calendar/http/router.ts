import { Router } from 'express'
import {
  createAlarmTestBody,
  createInspectionBody,
  elevatorInspectionsQuery,
  inspectionListQuery,
  updateInspectionBody,
} from '@avroleva/contracts'
import { ctxOf, requireAuth, requireRole } from '../../../platform/http/ctx.js'
import { parseBody, parseId, parseQuery } from '../../../platform/http/validate.js'
import * as service from '../service.js'

export const calendarRouter = Router()
calendarRouter.use(requireAuth)

const canEdit = requireRole('owner', 'office')

calendarRouter.get('/inspections', async (req, res) => {
  res.json(await service.list(ctxOf(req), parseQuery(inspectionListQuery, req)))
})
calendarRouter.post('/inspections', canEdit, async (req, res) => {
  res.status(201).json(await service.create(ctxOf(req), parseBody(createInspectionBody, req)))
})
calendarRouter.get('/inspections/:id', async (req, res) => {
  res.json(await service.get(ctxOf(req), parseId(req)))
})
calendarRouter.patch('/inspections/:id', canEdit, async (req, res) => {
  res.json(await service.update(ctxOf(req), parseId(req), parseBody(updateInspectionBody, req)))
})
calendarRouter.get('/elevators/:id/inspections', async (req, res) => {
  res.json(
    await service.listForElevator(
      ctxOf(req),
      parseId(req),
      parseQuery(elevatorInspectionsQuery, req),
    ),
  )
})
// Technicians test the voice link during their visits.
calendarRouter.get('/elevators/:id/alarm-tests', async (req, res) => {
  res.json({ items: await service.listAlarmTests(ctxOf(req), parseId(req)) })
})
calendarRouter.post('/elevators/:id/alarm-tests', async (req, res) => {
  res
    .status(201)
    .json(await service.logAlarmTest(ctxOf(req), parseId(req), parseBody(createAlarmTestBody, req)))
})
