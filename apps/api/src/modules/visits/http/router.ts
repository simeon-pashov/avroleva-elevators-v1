import { Router } from 'express'
import {
  amendVisitBody,
  createVisitBody,
  elevatorVisitsQuery,
  visitListQuery,
} from '@avroleva/contracts'
import { ctxOf, requireAuth, requireRole } from '../../../platform/http/ctx.js'
import { parseBody, parseId, parseQuery } from '../../../platform/http/validate.js'
import * as service from '../service.js'

export const visitsRouter = Router()
visitsRouter.use(requireAuth)

// Technicians record their own visits too (the office PWA comes in step 3; the API is ready).
const canRecord = requireRole('owner', 'office', 'technician')

visitsRouter.get('/visits', async (req, res) => {
  res.json(await service.list(ctxOf(req), parseQuery(visitListQuery, req)))
})
visitsRouter.post('/visits', canRecord, async (req, res) => {
  res.status(201).json(await service.record(ctxOf(req), parseBody(createVisitBody, req)))
})
visitsRouter.get('/visits/:id', async (req, res) => {
  res.json(await service.get(ctxOf(req), parseId(req)))
})
visitsRouter.post('/visits/:id/amend', requireRole('owner', 'office'), async (req, res) => {
  res
    .status(201)
    .json(await service.amend(ctxOf(req), parseId(req), parseBody(amendVisitBody, req)))
})
visitsRouter.get('/elevators/:id/visits', async (req, res) => {
  res.json(
    await service.listForElevator(ctxOf(req), parseId(req), parseQuery(elevatorVisitsQuery, req)),
  )
})
