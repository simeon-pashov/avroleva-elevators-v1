import { Router } from 'express'
import {
  bankImportPreviewBody,
  bulkInvoiceBody,
  createAccessLinkBody,
  createCreditNoteBody,
  createPaymentBody,
  generateInvoicesBody,
  invoiceListQuery,
  lateFeeRuleInput,
  matchBankRowBody,
  payInvoiceBody,
  saveDunningStagesBody,
  sendAccessLinkBody,
  statementQuery,
  summaryQuery,
} from '@avroleva/contracts'
import { z } from 'zod'
import { ctxOf, requireAuth, requireRole } from '../../../platform/http/ctx.js'
import { parseBody, parseId, parseQuery } from '../../../platform/http/validate.js'
import * as service from '../service.js'
import * as dunning from '../dunning.js'
import * as reconciliation from '../reconciliation.js'
import * as statements from '../statement.js'
import * as links from '../links.js'
import * as accessLinks from '../accessLinks.js'

export const billingRouter = Router()
billingRouter.use(requireAuth)

// Technicians never see money (ARCHITECTURE section 5, roles).
const office = requireRole('owner', 'office')
// Settings writes (dunning schedule, late-fee rules) are the owner's, like PATCH /tenant.
const owner = requireRole('owner')

billingRouter.get('/billing/config', office, async (req, res) => {
  res.json(await dunning.config(ctxOf(req)))
})
billingRouter.put('/billing/dunning-stages', owner, async (req, res) => {
  res.json({ stages: await dunning.saveStages(ctxOf(req), parseBody(saveDunningStagesBody, req)) })
})
const ruleKey = z.object({ key: z.string().regex(/^[a-z0-9_]{2,40}$/) })
billingRouter.put('/billing/late-fee-rules/:key', owner, async (req, res) => {
  const { key } = ruleKey.parse(req.params)
  res.json(await dunning.saveLateFeeRule(ctxOf(req), key, parseBody(lateFeeRuleInput, req)))
})
billingRouter.get('/billing/dunning/preview', office, async (req, res) => {
  res.json(await dunning.preview(ctxOf(req)))
})

billingRouter.post('/billing/invoices/generate', office, async (req, res) => {
  const body = parseBody(generateInvoicesBody, req)
  res.status(201).json(await service.generate(ctxOf(req), body.period))
})
billingRouter.get('/billing/invoices', office, async (req, res) => {
  res.json(await service.list(ctxOf(req), parseQuery(invoiceListQuery, req)))
})
billingRouter.post('/billing/invoices/bulk', office, async (req, res) => {
  res.json(await service.bulk(ctxOf(req), parseBody(bulkInvoiceBody, req), dunning.remindNow))
})
billingRouter.get('/billing/invoices/:id', office, async (req, res) => {
  res.json(await service.detail(ctxOf(req), parseId(req)))
})
billingRouter.post('/billing/invoices/:id/pay', office, async (req, res) => {
  res.json(await service.pay(ctxOf(req), parseId(req), parseBody(payInvoiceBody, req)))
})
billingRouter.post('/billing/invoices/:id/credit-notes', office, async (req, res) => {
  res
    .status(201)
    .json(
      await service.issueCreditNote(ctxOf(req), parseId(req), parseBody(createCreditNoteBody, req)),
    )
})
billingRouter.get('/billing/invoices/:id/credit-notes', office, async (req, res) => {
  res.json({ items: await service.creditNotesOf(ctxOf(req), parseId(req)) })
})
billingRouter.post('/billing/invoices/:id/payment-link', office, async (req, res) => {
  res.status(201).json({ link: await links.createPaymentLink(ctxOf(req), parseId(req)) })
})

billingRouter.post('/billing/payments', office, async (req, res) => {
  res.status(201).json(await service.createPayment(ctxOf(req), parseBody(createPaymentBody, req)))
})
billingRouter.get('/billing/payments', office, async (req, res) => {
  const q = parseQuery(invoiceListQuery.pick({ buildingId: true, month: true }), req)
  res.json({ items: await service.listPayments(ctxOf(req), q) })
})
billingRouter.get('/billing/summary', office, async (req, res) => {
  const q = parseQuery(summaryQuery, req)
  res.json(await service.summary(ctxOf(req).tenantId, q.month))
})

// Bank-statement import: preview -> manual match -> commit (ADR 0001 section 4).
billingRouter.get('/billing/bank-imports/presets', office, (_req, res) => {
  res.json({ items: reconciliation.presets() })
})
billingRouter.get('/billing/bank-imports', office, async (req, res) => {
  res.json({ items: await reconciliation.list(ctxOf(req)) })
})
billingRouter.post('/billing/bank-imports/preview', office, async (req, res) => {
  res
    .status(201)
    .json(await reconciliation.preview(ctxOf(req), parseBody(bankImportPreviewBody, req)))
})
billingRouter.get('/billing/bank-imports/:id', office, async (req, res) => {
  res.json(await reconciliation.get(ctxOf(req), parseId(req)))
})
billingRouter.put('/billing/bank-imports/:id/rows/:rowId', office, async (req, res) => {
  res.json(
    await reconciliation.matchRow(
      ctxOf(req),
      parseId(req),
      parseId(req, 'rowId'),
      parseBody(matchBankRowBody, req),
    ),
  )
})
billingRouter.post('/billing/bank-imports/:id/commit', office, async (req, res) => {
  res.json(await reconciliation.commit(ctxOf(req), parseId(req)))
})

billingRouter.get('/buildings/:id/billing', office, async (req, res) => {
  res.json(await service.buildingBilling(ctxOf(req), parseId(req)))
})
billingRouter.get('/buildings/:id/statement', office, async (req, res) => {
  res.json(await statements.statement(ctxOf(req), parseId(req), parseQuery(statementQuery, req)))
})
billingRouter.get('/elevators/:id/billing', office, async (req, res) => {
  res.json(await service.elevatorBilling(ctxOf(req), parseId(req)))
})

// Building access links (step 9): the magic link behind `/s/:token`. Owner + office manage and
// send them; the status endpoint carries no money, so every role may read it (elevator panel).
billingRouter.get('/buildings/:id/access-links', office, async (req, res) => {
  res.json({ items: await accessLinks.listLinks(ctxOf(req), parseId(req)) })
})
billingRouter.post('/buildings/:id/access-links', office, async (req, res) => {
  res
    .status(201)
    .json(
      await accessLinks.createLink(ctxOf(req), parseId(req), parseBody(createAccessLinkBody, req)),
    )
})
billingRouter.post('/buildings/:id/access-links/:linkId/rotate', office, async (req, res) => {
  res.json(await accessLinks.rotateLink(ctxOf(req), parseId(req), parseId(req, 'linkId')))
})
billingRouter.post('/buildings/:id/access-links/:linkId/revoke', office, async (req, res) => {
  res.json(await accessLinks.revokeLink(ctxOf(req), parseId(req), parseId(req, 'linkId')))
})
billingRouter.post('/buildings/:id/access-links/:linkId/send', office, async (req, res) => {
  res.json(
    await accessLinks.sendLink(
      ctxOf(req),
      parseId(req),
      parseId(req, 'linkId'),
      parseBody(sendAccessLinkBody, req),
    ),
  )
})
billingRouter.get('/buildings/:id/access-link-status', async (req, res) => {
  res.json(await accessLinks.linkStatus(ctxOf(req).tenantId, parseId(req)))
})
