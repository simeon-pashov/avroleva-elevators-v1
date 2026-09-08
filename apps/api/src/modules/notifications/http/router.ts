import { Router } from 'express'
import { z } from 'zod'
import {
  NotificationChannel,
  notificationListQuery,
  previewTemplateBody,
  testSendBody,
  updateRuleBody,
  upsertRuleParams,
  upsertTemplateBody,
  viberLinkBody,
} from '@avroleva/contracts'
import { ctxOf, requireAuth, requireRole } from '../../../platform/http/ctx.js'
import { parseBody, parseId, parseQuery } from '../../../platform/http/validate.js'
import * as service from '../service.js'

export const notificationsRouter = Router()
notificationsRouter.use(requireAuth)

// ---- Inbox (bell) - every role -------------------------------------------------------------

notificationsRouter.get('/notifications/inbox', async (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 30) || 30, 100)
  res.json(await service.inbox(ctxOf(req), limit))
})

notificationsRouter.post('/notifications/inbox/read', async (req, res) => {
  const body = z.object({ ids: z.array(z.uuid()).max(200).optional() }).parse(req.body ?? {})
  res.json({ marked: await service.markRead(ctxOf(req), body.ids ?? null) })
})

// ---- Delivery log, Viber links - owner/office ---------------------------------------------------

notificationsRouter.get('/notifications', requireRole('owner', 'office'), async (req, res) => {
  res.json(await service.log(ctxOf(req), parseQuery(notificationListQuery, req)))
})

notificationsRouter.post(
  '/notifications/:id/mark-sent',
  requireRole('owner', 'office'),
  async (req, res) => {
    res.json(await service.markSent(ctxOf(req), parseId(req)))
  },
)

/** Builds the Viber deep links for a phone + text (nothing is stored). */
notificationsRouter.post('/notifications/viber-link', async (req, res) => {
  const body = parseBody(viberLinkBody, req)
  res.json(service.viberLink(body.phone, body.text))
})

// ---- Rules and templates (Settings -> Уведомления) - owner/office ---------------------------------

notificationsRouter.get(
  '/notifications/rules',
  requireRole('owner', 'office'),
  async (req, res) => {
    res.json({ items: await service.listRules(ctxOf(req)) })
  },
)

notificationsRouter.put(
  '/notifications/rules/:eventType/:channel/:recipientKind',
  requireRole('owner', 'office'),
  async (req, res) => {
    const key = upsertRuleParams.parse(req.params)
    res.json(await service.upsertRule(ctxOf(req), key, parseBody(updateRuleBody, req)))
  },
)

notificationsRouter.get(
  '/notifications/templates',
  requireRole('owner', 'office'),
  async (req, res) => {
    res.json({ items: await service.listTemplates(ctxOf(req)) })
  },
)

const templateParams = z.object({
  key: z.string().trim().min(1).max(80),
  channel: NotificationChannel,
  locale: z.string().trim().min(2).max(5),
})

notificationsRouter.put(
  '/notifications/templates/:key/:channel/:locale',
  requireRole('owner'),
  async (req, res) => {
    const p = templateParams.parse(req.params)
    res.json(
      await service.upsertTemplate(
        ctxOf(req),
        p.key,
        p.channel,
        p.locale,
        parseBody(upsertTemplateBody, req),
      ),
    )
  },
)

notificationsRouter.delete(
  '/notifications/templates/:key/:channel/:locale',
  requireRole('owner'),
  async (req, res) => {
    const p = templateParams.parse(req.params)
    await service.resetTemplate(ctxOf(req), p.key, p.channel, p.locale)
    res.status(204).end()
  },
)

notificationsRouter.post(
  '/notifications/templates/preview',
  requireRole('owner', 'office'),
  async (req, res) => {
    res.json(await service.preview(ctxOf(req), parseBody(previewTemplateBody, req)))
  },
)

notificationsRouter.post(
  '/notifications/test-send',
  requireRole('owner', 'office'),
  async (req, res) => {
    res.status(201).json(await service.testSend(ctxOf(req), parseBody(testSendBody, req)))
  },
)
