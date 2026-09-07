import { Router } from 'express'
import {
  createDefectBody,
  defectListQuery,
  elevatorDefectsQuery,
  updateDefectBody,
} from '@avroleva/contracts'
import { ctxOf, requireAuth, requireRole } from '../../../platform/http/ctx.js'
import { parseBody, parseId, parseQuery } from '../../../platform/http/validate.js'
import * as service from '../service.js'

export const defectsRouter = Router()
defectsRouter.use(requireAuth)

// Technicians record defects from the field; status management is office work.
const canManage = requireRole('owner', 'office')

defectsRouter.get('/defects/catalog', (req, res) => {
  res.json({ items: service.catalog(ctxOf(req).locale) })
})
defectsRouter.get('/defects', async (req, res) => {
  res.json(await service.list(ctxOf(req), parseQuery(defectListQuery, req)))
})
defectsRouter.post('/defects', async (req, res) => {
  res.status(201).json(await service.record(ctxOf(req), parseBody(createDefectBody, req)))
})
defectsRouter.get('/defects/:id', async (req, res) => {
  res.json(await service.get(ctxOf(req), parseId(req)))
})
defectsRouter.patch('/defects/:id', canManage, async (req, res) => {
  res.json(await service.update(ctxOf(req), parseId(req), parseBody(updateDefectBody, req)))
})
defectsRouter.get('/elevators/:id/defects', async (req, res) => {
  res.json(
    await service.listForElevator(ctxOf(req), parseId(req), parseQuery(elevatorDefectsQuery, req)),
  )
})
