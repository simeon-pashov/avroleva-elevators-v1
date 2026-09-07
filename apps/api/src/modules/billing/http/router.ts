import { Router } from 'express'
import {
  createPaymentBody,
  generateInvoicesBody,
  invoiceListQuery,
  payInvoiceBody,
  summaryQuery,
} from '@avroleva/contracts'
import { ctxOf, requireAuth, requireRole } from '../../../platform/http/ctx.js'
import { parseBody, parseId, parseQuery } from '../../../platform/http/validate.js'
import * as service from '../service.js'

export const billingRouter = Router()
billingRouter.use(requireAuth)

// Technicians never see money (ARCHITECTURE section 5, roles).
const office = requireRole('owner', 'office')

billingRouter.post('/billing/invoices/generate', office, async (req, res) => {
  const body = parseBody(generateInvoicesBody, req)
  res.status(201).json(await service.generate(ctxOf(req), body.period))
})
billingRouter.get('/billing/invoices', office, async (req, res) => {
  res.json(await service.list(ctxOf(req), parseQuery(invoiceListQuery, req)))
})
billingRouter.get('/billing/invoices/:id', office, async (req, res) => {
  res.json(await service.get(ctxOf(req), parseId(req)))
})
billingRouter.post('/billing/invoices/:id/pay', office, async (req, res) => {
  res.json(await service.pay(ctxOf(req), parseId(req), parseBody(payInvoiceBody, req)))
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
billingRouter.get('/buildings/:id/billing', office, async (req, res) => {
  res.json(await service.buildingBilling(ctxOf(req), parseId(req)))
})
billingRouter.get('/elevators/:id/billing', office, async (req, res) => {
  res.json(await service.elevatorBilling(ctxOf(req), parseId(req)))
})
