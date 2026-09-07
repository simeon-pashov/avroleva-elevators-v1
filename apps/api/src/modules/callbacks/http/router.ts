import { Router } from 'express'
import type { Request } from 'express'
import {
  callbackListQuery,
  callbackTransitionBody,
  closeCallbackBody,
  createCallbackBody,
  dispatchCallbackBody,
  elevatorCallbacksQuery,
} from '@avroleva/contracts'
import { ctxOf, requireAuth, requireRole } from '../../../platform/http/ctx.js'
import { parseBody, parseId, parseQuery } from '../../../platform/http/validate.js'
import * as service from '../service.js'

export const callbacksRouter = Router()
callbacksRouter.use(requireAuth)

/** Timestamp provenance: the technician app announces itself with `X-Client: app`. */
function actor(req: Request) {
  return service.actorFromCtx(ctxOf(req), req.header('x-client') === 'app' ? 'app' : 'office')
}

callbacksRouter.get('/callbacks', async (req, res) => {
  res.json(await service.list(ctxOf(req), parseQuery(callbackListQuery, req)))
})
callbacksRouter.post('/callbacks', async (req, res) => {
  res.status(201).json(await service.open(actor(req), parseBody(createCallbackBody, req)))
})
callbacksRouter.get('/callbacks/:id', async (req, res) => {
  res.json(await service.get(ctxOf(req), parseId(req)))
})
callbacksRouter.post(
  '/callbacks/:id/dispatch',
  requireRole('owner', 'office'),
  async (req, res) => {
    res.json(await service.dispatch(actor(req), parseId(req), parseBody(dispatchCallbackBody, req)))
  },
)
for (const type of ['on_site', 'released', 'restored'] as const) {
  callbacksRouter.post(`/callbacks/:id/${type.replace('_', '-')}`, async (req, res) => {
    res.json(
      await service.transition(
        actor(req),
        parseId(req),
        type,
        parseBody(callbackTransitionBody, req),
      ),
    )
  })
}
callbacksRouter.post('/callbacks/:id/close', async (req, res) => {
  res.json(
    await service.close(ctxOf(req), actor(req), parseId(req), parseBody(closeCallbackBody, req)),
  )
})
callbacksRouter.get('/elevators/:id/callbacks', async (req, res) => {
  res.json(
    await service.listForElevator(
      ctxOf(req),
      parseId(req),
      parseQuery(elevatorCallbacksQuery, req),
    ),
  )
})
