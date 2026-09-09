import { Router } from 'express'
import type { Request } from 'express'
import { z } from 'zod'
import {
  completeJobBody,
  createJobBody,
  elevatorJobsQuery,
  invoiceJobBody,
  jobLineInput,
  jobListQuery,
  jobNoteBody,
  jobReasonBody,
  jobTransitionBody,
  saveJobStagesBody,
  scheduleJobBody,
  sendQuoteBody,
  startJobBody,
  updateJobBody,
  updateJobLineBody,
  uuid,
} from '@avroleva/contracts'
import { ctxOf, requireAuth, requireRole } from '../../../platform/http/ctx.js'
import { parseBody, parseId, parseQuery } from '../../../platform/http/validate.js'
import * as service from '../service.js'

export const jobsRouter = Router()
jobsRouter.use(requireAuth)

const office = requireRole('owner', 'office')

/** Timestamp provenance: the technician app announces itself with `X-Client: app`. */
function source(req: Request) {
  return req.header('x-client') === 'app' ? ('app' as const) : ('office' as const)
}

jobsRouter.get('/jobs/config', async (req, res) => {
  res.json(await service.config(ctxOf(req)))
})
jobsRouter.put('/jobs/stages', requireRole('owner'), async (req, res) => {
  res.json({ stages: await service.saveStages(ctxOf(req), parseBody(saveJobStagesBody, req)) })
})
jobsRouter.get('/jobs/summary', office, async (req, res) => {
  res.json(await service.summary(ctxOf(req).tenantId))
})

const byOriginQuery = z.object({
  originType: z.enum(['visit', 'callback', 'defect']),
  ids: z
    .string()
    .trim()
    .max(4000)
    .transform((s) => s.split(',').filter(Boolean))
    .pipe(z.array(uuid).max(100)),
})
jobsRouter.get('/jobs/by-origin', office, async (req, res) => {
  const q = parseQuery(byOriginQuery, req)
  res.json({ items: await service.byOrigin(ctxOf(req), q.originType, q.ids) })
})

jobsRouter.get('/jobs', async (req, res) => {
  res.json(await service.list(ctxOf(req), parseQuery(jobListQuery, req)))
})
jobsRouter.post('/jobs', office, async (req, res) => {
  res.status(201).json(await service.create(ctxOf(req), parseBody(createJobBody, req), source(req)))
})
jobsRouter.get('/jobs/:id', async (req, res) => {
  res.json(await service.get(ctxOf(req), parseId(req)))
})
jobsRouter.patch('/jobs/:id', office, async (req, res) => {
  res.json(await service.update(ctxOf(req), parseId(req), parseBody(updateJobBody, req)))
})

jobsRouter.post('/jobs/:id/lines', office, async (req, res) => {
  res
    .status(201)
    .json(await service.addLine(ctxOf(req), parseId(req), parseBody(jobLineInput, req)))
})
jobsRouter.patch('/jobs/:id/lines/:lineId', office, async (req, res) => {
  res.json(
    await service.updateLine(
      ctxOf(req),
      parseId(req),
      parseId(req, 'lineId'),
      parseBody(updateJobLineBody, req),
    ),
  )
})
jobsRouter.delete('/jobs/:id/lines/:lineId', office, async (req, res) => {
  res.json(await service.removeLine(ctxOf(req), parseId(req), parseId(req, 'lineId')))
})

jobsRouter.post('/jobs/:id/quote', office, async (req, res) => {
  res.json(await service.markQuoted(ctxOf(req), parseId(req)))
})
jobsRouter.post('/jobs/:id/send-quote', office, async (req, res) => {
  res.json(await service.sendQuote(ctxOf(req), parseId(req), parseBody(sendQuoteBody, req)))
})
jobsRouter.post('/jobs/:id/revise', office, async (req, res) => {
  const body = parseBody(z.object({ reason: z.string().trim().max(2000).optional() }), req)
  res.json(await service.revise(ctxOf(req), parseId(req), body.reason ?? null))
})
jobsRouter.post('/jobs/:id/transition', office, async (req, res) => {
  res.json(
    await service.transition(
      ctxOf(req),
      parseId(req),
      parseBody(jobTransitionBody, req),
      source(req),
    ),
  )
})
jobsRouter.post('/jobs/:id/schedule', office, async (req, res) => {
  res.json(await service.schedule(ctxOf(req), parseId(req), parseBody(scheduleJobBody, req)))
})
jobsRouter.post('/jobs/:id/start', async (req, res) => {
  res.json(await service.start(ctxOf(req), parseId(req), parseBody(startJobBody, req), source(req)))
})
jobsRouter.post('/jobs/:id/note', async (req, res) => {
  res.json(
    await service.addNote(ctxOf(req), parseId(req), parseBody(jobNoteBody, req), source(req)),
  )
})
jobsRouter.post('/jobs/:id/complete', async (req, res) => {
  res.json(
    await service.complete(ctxOf(req), parseId(req), parseBody(completeJobBody, req), source(req)),
  )
})
jobsRouter.post('/jobs/:id/invoice', office, async (req, res) => {
  res.json(await service.invoice(ctxOf(req), parseId(req), parseBody(invoiceJobBody, req)))
})
jobsRouter.post('/jobs/:id/reject', office, async (req, res) => {
  res.json(await service.reject(ctxOf(req), parseId(req), parseBody(jobReasonBody, req)))
})
jobsRouter.post('/jobs/:id/cancel', office, async (req, res) => {
  res.json(await service.cancel(ctxOf(req), parseId(req), parseBody(jobReasonBody, req)))
})

jobsRouter.get('/elevators/:id/jobs', async (req, res) => {
  res.json(
    await service.listForElevator(ctxOf(req), parseId(req), parseQuery(elevatorJobsQuery, req)),
  )
})
