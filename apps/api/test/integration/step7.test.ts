import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { disconnectDb, prismaBase } from '../../src/platform/db/prisma.js'
import { addDays, todayInSofia } from '../../src/platform/clock.js'
import { runJob } from '../../src/platform/jobs/registry.js'
import { registerSubscribers } from '../../src/subscribers.js'
import { ensureJobsRegistered } from '../../src/worker.js'
import { checklists } from '../../src/modules/maintenance/index.js'
import * as notifications from '../../src/modules/notifications/index.js'
import * as billing from '../../src/modules/billing/index.js'
import { generateDemoData } from '../../src/demo/generator.js'
import { resetDemoTenant } from '../../src/demo/reset.js'
import {
  CSRF,
  adminToken,
  app,
  bearer,
  createBuilding,
  createCustomer,
  createElevator,
  createTenant,
  resetDb,
  seedAdmin,
} from '../helpers.js'
import type { TenantFixture } from '../helpers.js'

let server: Express
let A: TenantFixture
let B: TenantFixture
let admin: string
let customerId: string
let buildingId: string
let elevatorId: string
let contractId: string
let bBuildingId: string
const today = todayInSofia()
const thisMonth = today.slice(0, 7)

function monthsAgo(n: number): string {
  const [y, m] = thisMonth.split('-').map(Number) as [number, number]
  const d = new Date(Date.UTC(y, m - 1 - n, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, ms = 8000): Promise<T> {
  const until = Date.now() + ms
  for (;;) {
    const v = await fn()
    if (v) return v as T
    if (Date.now() > until) throw new Error('waitFor timed out')
    await new Promise((r) => setTimeout(r, 100))
  }
}

beforeAll(async () => {
  await resetDb()
  await seedAdmin()
  await checklists.ensureSystemTemplates()
  await notifications.ensureSystemTemplates()
  await billing.ensureSystemBillingDefaults()
  registerSubscribers()
  ensureJobsRegistered()
  server = app()
  admin = await adminToken(server)
  A = await createTenant(server, 'Billing A')
  B = await createTenant(server, 'Billing B')
  customerId = (await createCustomer(server, A.ownerToken, 'ЕС „Тестова 1“')).id
  buildingId = (await createBuilding(server, A.ownerToken)).id
  elevatorId = (await createElevator(server, A.ownerToken, buildingId)).id
  // A building contact with an e-mail so dunning e-mails have a recipient.
  await request(server)
    .post('/api/v1/contacts')
    .set(bearer(A.ownerToken))
    .send({
      buildingId,
      customerId,
      name: 'Петя Димова',
      role: 'house_manager',
      phone: '0888 123 456',
      email: 'petya@example.com',
      isPrimary: true,
    })
    .expect(201)
  const contract = await request(server)
    .post('/api/v1/contracts')
    .set(bearer(A.ownerToken))
    .send({
      customerId,
      buildingId,
      startDate: '2025-01-01',
      lines: [{ elevatorId, monthlyPriceCents: 10000 }],
    })
  expect(contract.status, contract.text).toBe(201)
  contractId = contract.body.id
  bBuildingId = (await createBuilding(server, B.ownerToken, 'ж.к. Дружба', '9')).id
  // Default notification rules are created on a tenant's first read (step 5).
  await request(server).get('/api/v1/notifications/rules').set(bearer(A.ownerToken)).expect(200)
  // Tenant A: bank details + demoMode off by default.
  const settings = await request(server)
    .patch('/api/v1/tenant')
    .set(bearer(A.ownerToken))
    .send({
      settings: {
        billing: {
          runDay: 1,
          runEnabled: true,
          dueDays: 10,
          bank: {
            beneficiary: 'Тест Лифт ЕООД',
            iban: 'BG80 BNBG 9661 1020 3456 78',
            bic: 'BNBGBGSD',
            bankName: 'БНБ',
          },
          paymentProvider: 'none',
          showPaymentOnPublicPage: true,
        },
      },
    })
  expect(settings.status, settings.text).toBe(200)
  expect(settings.body.settings.billing.bank.iban).toBe('BG80BNBG96611020345678')
})

afterAll(async () => {
  await disconnectDb()
})

describe('settings: bank details and billing defaults', () => {
  it('rejects a bad IBAN checksum with a field error and keeps the rest', async () => {
    const res = await request(server)
      .patch('/api/v1/tenant')
      .set(bearer(A.ownerToken))
      .send({ settings: { billing: { bank: { iban: 'BG80BNBG96611020345679' } } } })
    expect(res.status).toBe(400)
    expect(res.body.fields.map((f: { path: string }) => f.path)).toContain(
      'settings.billing.bank.iban',
    )
    const me = await request(server).get('/api/v1/tenant').set(bearer(A.ownerToken))
    expect(me.body.settings.billing.bank.iban).toBe('BG80BNBG96611020345678')
    expect(me.body.settings.billing.runDay).toBe(1)
  })
  it('GET /billing/config exposes states, transitions, system stages and providers as data', async () => {
    const res = await request(server).get('/api/v1/billing/config').set(bearer(A.ownerToken))
    expect(res.status, res.text).toBe(200)
    expect(res.body.states.map((s: { key: string }) => s.key)).toContain('partially_paid')
    expect(res.body.transitions.length).toBeGreaterThan(5)
    expect(
      res.body.stages.map((s: { key: string; position: number }) => `${s.position}:${s.key}`),
    ).toEqual(['1:reminder', '2:second_reminder', '3:final_notice'])
    expect(res.body.stagesCustomised).toBe(false)
    expect(res.body.lateFeeRules[0]).toMatchObject({ key: 'late_fee', enabled: false })
    const providers = Object.fromEntries(
      res.body.providers.map((p: { name: string; enabled: boolean }) => [p.name, p.enabled]),
    )
    expect(providers).toEqual({ none: false, demo: false, iris: false, stripe: false })
    expect(res.body.referenceSample).toMatch(/^AE-\d{4}-000001$/)
    await request(server).get('/api/v1/billing/config').set(bearer(B.ownerToken)).expect(200)
  })
})

describe('scheduled billing run', () => {
  it('runs on the run day for the current month, is idempotent, and waits before the run day', async () => {
    const early = await billing.runScheduled(A.tenantId, `${thisMonth}-01`)
    expect(early).toMatchObject({ period: thisMonth, due: true, created: 1 })
    const inv = await prismaBase.invoice.findFirst({ where: { tenantId: A.tenantId, contractId } })
    expect(inv!.paymentReference).toMatch(/^AE-\d{4}-000001$/)
    expect(inv!.dueAt.toISOString().slice(0, 10)).toBe(addDays(`${thisMonth}-01`, 10))
    expect(inv!.status).toBe('issued')
    const again = await billing.runScheduled(A.tenantId, `${thisMonth}-15`)
    expect(again.created).toBe(0)
    expect(await prismaBase.invoice.count({ where: { tenantId: A.tenantId } })).toBe(1)
    // Run day later in the month: nothing before it.
    await prismaBase.tenant.update({
      where: { id: A.tenantId },
      data: {
        settings: {
          billing: {
            runDay: 20,
            dueDays: 10,
            bank: {
              beneficiary: 'Тест Лифт ЕООД',
              iban: 'BG80BNBG96611020345678',
              bic: 'BNBGBGSD',
              bankName: 'БНБ',
            },
          },
        },
      },
    })
    const next = monthsAgo(-1)
    expect((await billing.runScheduled(A.tenantId, `${next}-05`)).due).toBe(false)
    expect((await billing.runScheduled(A.tenantId, `${next}-20`)).created).toBe(1)
    await prismaBase.tenant.update({
      where: { id: A.tenantId },
      data: {
        settings: {
          billing: {
            runDay: 1,
            dueDays: 10,
            bank: {
              beneficiary: 'Тест Лифт ЕООД',
              iban: 'BG80BNBG96611020345678',
              bic: 'BNBGBGSD',
              bankName: 'БНБ',
            },
          },
        },
      },
    })
    const job = (await runJob('billing.run')) as Record<string, { created: number }>
    expect(job[A.tenantId]!.created).toBe(0)
    expect(job[B.tenantId]!.created).toBe(0)
    const issued = await prismaBase.domainEvent.count({
      where: { tenantId: A.tenantId, type: 'InvoiceIssued' },
    })
    expect(issued).toBe(2)
  })
  it('quarterly and exempt contract overrides', async () => {
    const b2 = await createBuilding(server, A.ownerToken, 'ж.к. Люлин 5', '512')
    const e2 = await createElevator(server, A.ownerToken, b2.id, 'вх. Б')
    const q = await request(server)
      .post('/api/v1/contracts')
      .set(bearer(A.ownerToken))
      .send({
        customerId,
        buildingId: b2.id,
        startDate: '2025-01-15',
        billing: { cycle: 'quarterly', exempt: false },
        lines: [{ elevatorId: e2.id, monthlyPriceCents: 3000 }],
      })
    expect(q.status, q.text).toBe(201)
    expect(q.body.billing).toEqual({ cycle: 'quarterly', anchorDay: null, exempt: false })
    const b3 = await createBuilding(server, A.ownerToken, 'ж.к. Надежда', '3')
    const e3 = await createElevator(server, A.ownerToken, b3.id, 'вх. В')
    const ex = await request(server)
      .post('/api/v1/contracts')
      .set(bearer(A.ownerToken))
      .send({
        customerId,
        buildingId: b3.id,
        startDate: '2025-01-01',
        billing: { cycle: 'monthly', exempt: true },
        lines: [{ elevatorId: e3.id, monthlyPriceCents: 9999 }],
      })
    expect(ex.status, ex.text).toBe(201)
    // Quarter starts in Jan / Apr / Jul / Oct; generate for a quarter month and a non-quarter month.
    const r1 = await request(server)
      .post('/api/v1/billing/invoices/generate')
      .set(bearer(A.ownerToken))
      .send({ period: '2026-04' })
    expect(r1.status).toBe(201)
    const quarterly = r1.body.invoices.find(
      (i: { contractId: string }) => i.contractId === q.body.id,
    )
    expect(quarterly).toBeDefined()
    expect(quarterly.periodEnd).toBe('2026-06-30')
    expect(quarterly.amountCents).toBe(9000)
    expect(
      r1.body.invoices.find((i: { contractId: string }) => i.contractId === ex.body.id),
    ).toBeUndefined()
    const r2 = await request(server)
      .post('/api/v1/billing/invoices/generate')
      .set(bearer(A.ownerToken))
      .send({ period: '2026-05' })
    expect(
      r2.body.invoices.find((i: { contractId: string }) => i.contractId === q.body.id),
    ).toBeUndefined()
    await request(server)
      .patch(`/api/v1/contracts/${q.body.id}`)
      .set(bearer(A.ownerToken))
      .send({ billing: null })
      .expect(200)
    await request(server)
      .patch(`/api/v1/contracts/${ex.body.id}`)
      .set(bearer(A.ownerToken))
      .send({ status: 'terminated', endDate: '2026-01-31' })
  })
})

describe('dunning as data', () => {
  let overdueId: string
  it('the daily job moves an overdue invoice through the stages, notifies, and stops when paid', async () => {
    // An invoice due 20 days ago: the default schedule reached "second_reminder" (+14).
    const r = await request(server)
      .post('/api/v1/billing/invoices/generate')
      .set(bearer(A.ownerToken))
      .send({ period: '2026-01' })
    expect(r.status).toBe(201)
    const jan = r.body.invoices.find((i: { contractId: string }) => i.contractId === contractId)
    overdueId = jan.id
    await prismaBase.invoice.update({
      where: { id: overdueId },
      data: { dueAt: new Date(addDays(today, -20) + 'T00:00:00Z') },
    })
    const preview = await request(server)
      .get('/api/v1/billing/dunning/preview')
      .set(bearer(A.ownerToken))
    expect(preview.status).toBe(200)
    const item = preview.body.items.find((i: { invoiceId: string }) => i.invoiceId === overdueId)
    expect(item).toMatchObject({
      currentStage: 0,
      nextStageKey: 'second_reminder',
      nextStagePosition: 2,
      channel: 'email',
    })

    const job = (await runJob('billing.dunning')) as Record<string, { reached: number }>
    expect(job[A.tenantId]!.reached).toBeGreaterThanOrEqual(1)
    const inv = await prismaBase.invoice.findUnique({ where: { id: overdueId } })
    expect(inv!.dunningStage).toBe(2)
    expect(inv!.dunningStageKey).toBe('second_reminder')
    expect(inv!.status).toBe('overdue')
    // Second run the same day: nothing new.
    expect((await billing.runDunning(A.tenantId)).reached).toBe(0)

    // Notifications: e-mail to the building contact with the stage's template, in-app to the office.
    const email = await waitFor(() =>
      prismaBase.notification.findFirst({
        where: {
          tenantId: A.tenantId,
          eventType: 'DunningStageReached',
          channel: 'email',
          relatedId: overdueId,
        },
      }),
    )
    expect(email.to).toBe('petya@example.com')
    expect(email.subject).toContain('второ напомняне')
    expect(email.body).toContain('AE-')
    const inApp = await waitFor(() =>
      prismaBase.notification.findFirst({
        where: {
          tenantId: A.tenantId,
          eventType: 'DunningStageReached',
          channel: 'in_app',
          relatedId: overdueId,
        },
      }),
    )
    expect(inApp.link).toBe(`/invoices/${overdueId}`)
    const event = await prismaBase.domainEvent.findFirst({
      where: { tenantId: A.tenantId, type: 'DunningStageReached', aggregateId: overdueId },
    })
    expect(event!.payload).toMatchObject({
      stageKey: 'second_reminder',
      templateKey: 'dunning_second',
      channel: 'email',
    })
    const audit = await prismaBase.auditLog.findFirst({
      where: { tenantId: A.tenantId, action: 'invoice.dunning' },
    })
    expect(audit).not.toBeNull()

    // Tenant B has nothing to dun.
    expect(job[B.tenantId]).toEqual({ reached: 0, lateFees: 0, lateFeeCents: 0 })
  })
  it('a tenant-customised schedule with an enabled late fee adds an adjustment, never edits the invoice', async () => {
    const rule = await request(server)
      .put('/api/v1/billing/late-fee-rules/late_fee')
      .set(bearer(A.ownerToken))
      .send({
        kind: 'flat',
        amountCents: 1500,
        percentBp: 0,
        graceDays: 25,
        capCents: 2000,
        enabled: true,
      })
    expect(rule.status, rule.text).toBe(200)
    const stages = await request(server)
      .put('/api/v1/billing/dunning-stages')
      .set(bearer(A.ownerToken))
      .send({
        stages: [
          {
            key: 'reminder',
            offsetDays: 3,
            channel: 'email',
            templateKey: 'dunning_reminder',
            lateFeeRuleKey: null,
            active: true,
          },
          {
            key: 'stern',
            offsetDays: 19,
            channel: 'in_app',
            templateKey: 'dunning_final',
            lateFeeRuleKey: 'late_fee',
            active: true,
          },
        ],
      })
    expect(stages.status, stages.text).toBe(200)
    expect(
      stages.body.stages.map((s: { key: string; position: number }) => `${s.position}:${s.key}`),
    ).toEqual(['1:reminder', '2:stern'])
    const cfg = await request(server).get('/api/v1/billing/config').set(bearer(A.ownerToken))
    expect(cfg.body.stagesCustomised).toBe(true)
    // Stage 2 of the new list is "stern" (+19); the invoice is at position 2 already -> nothing today.
    expect((await billing.runDunning(A.tenantId)).reached).toBe(0)
    // Move the invoice back one stage: the stern stage fires with the fee (grace 25 days: due 20 days ago -> not yet).
    await prismaBase.invoice.update({ where: { id: overdueId }, data: { dunningStage: 1 } })
    const r1 = await billing.runDunning(A.tenantId)
    expect(r1).toEqual({ reached: 1, lateFees: 0, lateFeeCents: 0 })
    // Grace over: the fee lands once, capped, as an adjustment; the invoice total is untouched.
    await prismaBase.invoice.update({
      where: { id: overdueId },
      data: { dunningStage: 1, dueAt: new Date(addDays(today, -40) + 'T00:00:00Z') },
    })
    const before = await prismaBase.invoice.findUnique({ where: { id: overdueId } })
    const r2 = await billing.runDunning(A.tenantId)
    expect(r2).toEqual({ reached: 1, lateFees: 1, lateFeeCents: 1500 })
    const after = await prismaBase.invoice.findUnique({ where: { id: overdueId } })
    expect(after!.totalCents).toBe(before!.totalCents)
    expect(after!.lateFeeCents).toBe(1500)
    const adj = await prismaBase.invoiceAdjustment.findMany({
      where: { tenantId: A.tenantId, invoiceId: overdueId },
    })
    expect(adj).toHaveLength(1)
    expect(adj[0]).toMatchObject({ kind: 'late_fee', amountCents: 1500, stageKey: 'stern' })
    // Same stage again never doubles the fee.
    await prismaBase.invoice.update({ where: { id: overdueId }, data: { dunningStage: 1 } })
    expect((await billing.runDunning(A.tenantId)).lateFees).toBe(0)
    const detail = await request(server)
      .get(`/api/v1/billing/invoices/${overdueId}`)
      .set(bearer(A.ownerToken))
    expect(detail.body.openCents).toBe(before!.totalCents + 1500)
    expect(detail.body.adjustments).toHaveLength(1)
    // In-app stage: the building contact gets nothing, the office does.
    const contactEmails = await prismaBase.notification.count({
      where: {
        tenantId: A.tenantId,
        eventType: 'DunningStageReached',
        channel: 'email',
        relatedId: overdueId,
      },
    })
    expect(contactEmails).toBe(1)
    // Restore the system schedule for the rest of the suite.
    await request(server)
      .put('/api/v1/billing/dunning-stages')
      .set(bearer(A.ownerToken))
      .send({ stages: [] })
      .expect(200)
    expect(
      (await request(server).get('/api/v1/billing/config').set(bearer(A.ownerToken))).body
        .stagesCustomised,
    ).toBe(false)
    await request(server)
      .put('/api/v1/billing/late-fee-rules/late_fee')
      .set(bearer(A.ownerToken))
      .send({ enabled: false })
      .expect(200)
  })
  it('paying the invoice stops dunning; a credit note reduces the balance and emits CreditNoteIssued', async () => {
    const detail = await request(server)
      .get(`/api/v1/billing/invoices/${overdueId}`)
      .set(bearer(A.ownerToken))
    const open = detail.body.openCents as number
    const cn = await request(server)
      .post(`/api/v1/billing/invoices/${overdueId}/credit-notes`)
      .set(bearer(A.ownerToken))
      .send({ totalCents: 1500, reason: 'Отстъпка за закъснялата проверка' })
    expect(cn.status, cn.text).toBe(201)
    expect(cn.body.number).toBe(1)
    expect(cn.body.totalCents).toBe(1500)
    expect(cn.body.vatCents).toBe(250)
    const after = await request(server)
      .get(`/api/v1/billing/invoices/${overdueId}`)
      .set(bearer(A.ownerToken))
    expect(after.body.openCents).toBe(open - 1500)
    expect(after.body.creditedCents).toBe(1500)
    expect(after.body.creditNotes).toHaveLength(1)
    await request(server)
      .post(`/api/v1/billing/invoices/${overdueId}/credit-notes`)
      .set(bearer(A.ownerToken))
      .send({ totalCents: open, reason: 'too much' })
      .expect(400)
    const ev = await prismaBase.domainEvent.findFirst({
      where: { tenantId: A.tenantId, type: 'CreditNoteIssued' },
    })
    expect(ev!.payload).toMatchObject({ number: 1, totalCents: 1500 })
    const paid = await request(server)
      .post(`/api/v1/billing/invoices/${overdueId}/pay`)
      .set(bearer(A.ownerToken))
      .send({ paidAt: today, method: 'bank' })
    expect(paid.status, paid.text).toBe(200)
    expect(paid.body.status).toBe('paid')
    expect(paid.body.openCents).toBe(0)
    const preview = await request(server)
      .get('/api/v1/billing/dunning/preview')
      .set(bearer(A.ownerToken))
    expect(
      preview.body.items.find((i: { invoiceId: string }) => i.invoiceId === overdueId),
    ).toBeUndefined()
    expect((await billing.runDunning(A.tenantId)).reached).toBe(0)
    // Second credit note number follows gaplessly.
    const inv2 = (await prismaBase.invoice.findFirst({
      where: { tenantId: A.tenantId, status: { in: ['issued', 'overdue', 'partially_paid'] } },
    }))!
    const cn2 = await request(server)
      .post(`/api/v1/billing/invoices/${inv2.id}/credit-notes`)
      .set(bearer(A.ownerToken))
      .send({ totalCents: 100, reason: 'rounding' })
    expect(cn2.body.number).toBe(2)
  })
})

describe('payments, references and partial / over-payments', () => {
  it('partial payment -> partially_paid; the rest -> paid; over-payment leaves an unallocated remainder', async () => {
    const inv = (await prismaBase.invoice.findFirst({
      where: { tenantId: A.tenantId, status: 'issued' },
      orderBy: { number: 'asc' },
    }))!
    const open = inv.totalCents + inv.lateFeeCents - inv.creditedCents - inv.paidCents
    const p1 = await request(server)
      .post(`/api/v1/billing/invoices/${inv.id}/pay`)
      .set(bearer(A.ownerToken))
      .send({ paidAt: today, method: 'cash', amountCents: 1000 })
    expect(p1.status, p1.text).toBe(200)
    expect(p1.body.status).toBe('partially_paid')
    expect(p1.body.openCents).toBe(open - 1000)
    const p2 = await request(server)
      .post(`/api/v1/billing/invoices/${inv.id}/pay`)
      .set(bearer(A.ownerToken))
      .send({ paidAt: today, method: 'bank', amountCents: open - 1000 + 700 })
    expect(p2.body.status).toBe('paid')
    const payments = await prismaBase.payment.findMany({
      where: { tenantId: A.tenantId, paidAt: new Date(today + 'T00:00:00Z') },
      orderBy: { createdAt: 'asc' },
    })
    const remainder = payments.find((p) => p.invoiceId === null && p.amountCents === 700)
    expect(remainder).toBeDefined()
    expect(remainder!.note).toContain('overpayment')
    const detail = await request(server)
      .get(`/api/v1/billing/invoices/${inv.id}`)
      .set(bearer(A.ownerToken))
    expect(detail.body.payments.map((p: { amountCents: number }) => p.amountCents).sort()).toEqual(
      [1000, open - 1000].sort(),
    )
    expect(detail.body.payments[0].reference).toBe(inv.paymentReference)
  })
  it('the list filters by q (number / reference) and by dunning stage; bulk pay', async () => {
    const list = await request(server)
      .get('/api/v1/billing/invoices')
      .query({ q: 'AE-' })
      .set(bearer(A.ownerToken))
    expect(list.status).toBe(200)
    expect(list.body.items.length).toBeGreaterThan(2)
    const byNumber = await request(server)
      .get('/api/v1/billing/invoices')
      .query({ q: '1' })
      .set(bearer(A.ownerToken))
    expect(byNumber.body.items.some((i: { number: number }) => i.number === 1)).toBe(true)
    const staged = await request(server)
      .get('/api/v1/billing/invoices')
      .query({ dunningStage: 1 })
      .set(bearer(A.ownerToken))
    expect(staged.body.items.every((i: { dunningStage: number }) => i.dunningStage >= 1)).toBe(true)
    const pending = await request(server)
      .get('/api/v1/billing/invoices')
      .query({ pending: true })
      .set(bearer(A.ownerToken))
    const ids = pending.body.items.map((i: { id: string }) => i.id)
    expect(ids.length).toBeGreaterThan(0)
    const bulk = await request(server)
      .post('/api/v1/billing/invoices/bulk')
      .set(bearer(A.ownerToken))
      .send({ action: 'pay', ids })
    expect(bulk.status, bulk.text).toBe(200)
    expect(bulk.body.done).toBe(ids.length)
    expect(
      (
        await request(server)
          .get('/api/v1/billing/invoices')
          .query({ pending: true })
          .set(bearer(A.ownerToken))
      ).body.items,
    ).toHaveLength(0)
  })
})

describe('bank-statement import -> match -> statement balance', () => {
  let importId: string
  let refInvoice: { id: string; paymentReference: string; totalCents: number; number: number }
  let nameInvoice: { id: string; totalCents: number }
  it('preview auto-matches by reference and by amount + name, keeps the rest unallocated', async () => {
    // Two fresh open invoices: one paid by reference, one by exact amount + customer name.
    const gen = await request(server)
      .post('/api/v1/billing/invoices/generate')
      .set(bearer(A.ownerToken))
      .send({ period: '2025-11' })
    expect(gen.status).toBe(201)
    refInvoice = gen.body.invoices.find((i: { contractId: string }) => i.contractId === contractId)
    const gen2 = await request(server)
      .post('/api/v1/billing/invoices/generate')
      .set(bearer(A.ownerToken))
      .send({ period: '2025-12' })
    nameInvoice = gen2.body.invoices.find(
      (i: { contractId: string }) => i.contractId === contractId,
    )
    const text = [
      'Дата;Вальор;Дебит;Кредит;Валута;Наредител/Получател;Основание;Референция',
      `02.09.2026;02.09.2026;;${(refInvoice.totalCents / 100).toFixed(2).replace('.', ',')};EUR;Някой друг;превод ${refInvoice.paymentReference};X1`,
      `03.09.2026;03.09.2026;;${(nameInvoice.totalCents / 100).toFixed(2).replace('.', ',')};EUR;ЕС Тестова 1;поддръжка;X2`,
      '04.09.2026;04.09.2026;;33,33;EUR;Непознат;без основание;X3',
      '05.09.2026;05.09.2026;12,00;;EUR;Банка;такса;X4',
    ].join('\n')
    const res = await request(server)
      .post('/api/v1/billing/bank-imports/preview')
      .set(bearer(A.ownerToken))
      .send({ filename: 'izvlechenie.csv', text })
    expect(res.status, res.text).toBe(201)
    importId = res.body.id
    expect(res.body.status).toBe('preview')
    expect(res.body.rows).toHaveLength(3)
    expect(res.body.rows[0]).toMatchObject({
      matchKind: 'reference',
      status: 'proposed',
      invoiceId: refInvoice.id,
      invoiceNumber: refInvoice.number,
    })
    expect(res.body.rows[1]).toMatchObject({
      matchKind: 'amount_name',
      status: 'proposed',
      invoiceId: nameInvoice.id,
    })
    expect(res.body.rows[2]).toMatchObject({ matchKind: 'none', status: 'unallocated' })
    expect(res.body.mapping.delimiter).toBe(';')
    // The mapping is remembered on the tenant.
    const me = await request(server).get('/api/v1/tenant').set(bearer(A.ownerToken))
    expect(me.body.settings.billing.bankCsvMapping.delimiter).toBe(';')
    const presets = await request(server)
      .get('/api/v1/billing/bank-imports/presets')
      .set(bearer(A.ownerToken))
    expect(presets.body.items).toHaveLength(3)
  })
  it('manual match, commit, statement running balance, PaymentMatched events', async () => {
    const imp = await request(server)
      .get(`/api/v1/billing/bank-imports/${importId}`)
      .set(bearer(A.ownerToken))
    const row3 = imp.body.rows[2]
    const matched = await request(server)
      .put(`/api/v1/billing/bank-imports/${importId}/rows/${row3.id}`)
      .set(bearer(A.ownerToken))
      .send({ buildingId })
    expect(matched.status, matched.text).toBe(200)
    expect(matched.body.rows[2]).toMatchObject({
      status: 'matched',
      matchKind: 'manual',
      buildingId,
    })
    const commit = await request(server)
      .post(`/api/v1/billing/bank-imports/${importId}/commit`)
      .set(bearer(A.ownerToken))
    expect(commit.status, commit.text).toBe(200)
    expect(commit.body).toEqual({ importId, booked: 3, unallocated: 0, ignored: 0 })
    await request(server)
      .post(`/api/v1/billing/bank-imports/${importId}/commit`)
      .set(bearer(A.ownerToken))
      .expect(409)
    const ref = await request(server)
      .get(`/api/v1/billing/invoices/${refInvoice.id}`)
      .set(bearer(A.ownerToken))
    expect(ref.body.status).toBe('paid')
    expect(ref.body.payments[0]).toMatchObject({
      source: 'bank_import',
      reference: refInvoice.paymentReference,
      counterparty: 'Някой друг',
    })
    const matchedEvents = await prismaBase.domainEvent.count({
      where: { tenantId: A.tenantId, type: 'PaymentMatched' },
    })
    expect(matchedEvents).toBe(3)
    const officeRow = await waitFor(() =>
      prismaBase.notification.findFirst({
        where: { tenantId: A.tenantId, eventType: 'PaymentMatched', channel: 'in_app' },
      }),
    )
    expect(officeRow.subject).toContain('Плащане')

    const st = await request(server)
      .get(`/api/v1/buildings/${buildingId}/statement`)
      .query({ from: '2025-01-01', to: today })
      .set(bearer(A.ownerToken))
    expect(st.status, st.text).toBe(200)
    expect(st.body.openingBalanceCents).toBe(0)
    const debits = st.body.lines
      .filter((l: { kind: string }) => l.kind === 'invoice' || l.kind === 'late_fee')
      .reduce((s: number, l: { debitCents: number }) => s + l.debitCents, 0)
    const credits = st.body.lines
      .filter((l: { kind: string }) => l.kind === 'payment' || l.kind === 'credit_note')
      .reduce((s: number, l: { creditCents: number }) => s + l.creditCents, 0)
    expect(st.body.closingBalanceCents).toBe(debits - credits)
    expect(st.body.lines[st.body.lines.length - 1].balanceCents).toBe(st.body.closingBalanceCents)
    expect(st.body.lines.some((l: { kind: string }) => l.kind === 'credit_note')).toBe(true)
    expect(st.body.lines.some((l: { kind: string }) => l.kind === 'late_fee')).toBe(true)
    expect(st.body.bank.ibanFormatted).toBe('BG80 BNBG 9661 1020 3456 78')
    // Everything is paid now except the unallocated remainder: the closing balance is negative and no EPC.
    expect(st.body.openInvoices).toHaveLength(0)
    expect(st.body.epc).toBeNull()
    expect(st.body.printUrl).toContain(`/print/statement/${buildingId}?from=2025-01-01`)
    const print = await request(server)
      .get(`/print/statement/${buildingId}`)
      .query({ from: '2025-01-01', to: today })
      .set(bearer(A.ownerToken))
    expect(print.status).toBe(200)
    expect(print.text).toContain('BG80 BNBG 9661 1020 3456 78')
    expect(print.text).toContain('Извлечение по сметка')
    const list = await request(server).get('/api/v1/billing/bank-imports').set(bearer(A.ownerToken))
    expect(list.body.items[0]).toMatchObject({ id: importId, status: 'committed', bookedCount: 3 })
  })
  it('a later manual match on a committed import books the payment immediately', async () => {
    const text =
      'Date,Amount,Currency,Counterparty,Details,Reference\n06/09/2026,5.00,EUR,"Anon","nothing",Z1\n'
    const res = await request(server)
      .post('/api/v1/billing/bank-imports/preview')
      .set(bearer(A.ownerToken))
      .send({ filename: 'x.csv', text, preset: 'en_comma_signed' })
    expect(res.status, res.text).toBe(201)
    const id = res.body.id
    const commit = await request(server)
      .post(`/api/v1/billing/bank-imports/${id}/commit`)
      .set(bearer(A.ownerToken))
    expect(commit.body).toEqual({ importId: id, booked: 0, unallocated: 1, ignored: 0 })
    const rowId = res.body.rows[0].id
    const later = await request(server)
      .put(`/api/v1/billing/bank-imports/${id}/rows/${rowId}`)
      .set(bearer(A.ownerToken))
      .send({ buildingId })
    expect(later.body.rows[0]).toMatchObject({ status: 'booked' })
    expect(later.body.rows[0].paymentId).toBeTruthy()
    await request(server)
      .put(`/api/v1/billing/bank-imports/${id}/rows/${rowId}`)
      .set(bearer(A.ownerToken))
      .send({ ignore: true })
      .expect(409)
  })
  it('unreadable files answer 400', async () => {
    await request(server)
      .post('/api/v1/billing/bank-imports/preview')
      .set(bearer(A.ownerToken))
      .send({ filename: 'x.csv', text: 'a,b\n1,2\n', mapping: undefined })
      .expect(400)
  })
})

describe('invoice document, EPC QR and the public page', () => {
  let openId: string
  it('detail and print carry the bank block, the reference and an EPC SVG while open', async () => {
    const gen = await request(server)
      .post('/api/v1/billing/invoices/generate')
      .set(bearer(A.ownerToken))
      .send({ period: '2025-10' })
    openId = gen.body.invoices.find((i: { contractId: string }) => i.contractId === contractId).id
    const detail = await request(server)
      .get(`/api/v1/billing/invoices/${openId}`)
      .set(bearer(A.ownerToken))
    expect(detail.status).toBe(200)
    expect(detail.body.bank).toMatchObject({ beneficiary: 'Тест Лифт ЕООД', bic: 'BNBGBGSD' })
    expect(detail.body.epc.svg).toContain('<svg')
    expect(detail.body.epc.payload.split('\n').slice(0, 4)).toEqual(['BCD', '002', '1', 'SCT'])
    expect(detail.body.epc.payload).toContain(detail.body.paymentReference)
    expect(detail.body.epc.amountCents).toBe(detail.body.openCents)
    expect(detail.body.paymentProvider).toMatchObject({ name: 'none', enabled: false })
    const print = await request(server).get(`/print/invoice/${openId}`).set(bearer(A.ownerToken))
    expect(print.status).toBe(200)
    expect(print.text).toContain(detail.body.paymentReference)
    expect(print.text).toContain('<svg')
    expect(print.text).toContain('data-copy="BG80BNBG96611020345678"')
    await request(server).get(`/print/invoice/${openId}`).set(bearer(B.ownerToken)).expect(404)
  })
  it('the public QR page shows the payment block only with an open balance and the setting on', async () => {
    await request(server)
      .patch('/api/v1/tenant')
      .set(bearer(A.ownerToken))
      .send({ features: { publicQrPage: true } })
      .expect(200)
    const e = await request(server).get(`/api/v1/elevators/${elevatorId}`).set(bearer(A.ownerToken))
    const token = e.body.publicUrl.split('/p/')[1]
    const page = await request(server).get(`/p/${token}`)
    expect(page.status).toBe(200)
    expect(page.text).toContain('BG80 BNBG 9661 1020 3456 78')
    expect(page.text).toContain('<svg')
    expect(page.text).toContain('print.js')
    const me = await request(server).get('/api/v1/tenant').set(bearer(A.ownerToken))
    await request(server)
      .patch('/api/v1/tenant')
      .set(bearer(A.ownerToken))
      .send({
        settings: { billing: { ...me.body.settings.billing, showPaymentOnPublicPage: false } },
      })
      .expect(200)
    const off = await request(server).get(`/p/${token}`)
    expect(off.text).not.toContain('BG80 BNBG')
    await request(server)
      .patch('/api/v1/tenant')
      .set(bearer(A.ownerToken))
      .send({
        settings: { billing: { ...me.body.settings.billing, showPaymentOnPublicPage: true } },
      })
      .expect(200)
  })
  it('statement e-mail: sent with the attachment, logged as a statement run', async () => {
    const res = await request(server)
      .post(`/api/v1/reports/statement/${buildingId}/send`)
      .set(bearer(A.ownerToken))
      .send({ from: '2025-01-01', to: today })
    expect(res.status, res.text).toBe(201)
    expect(res.body).toMatchObject({
      kind: 'statement',
      status: 'sent',
      sentTo: 'petya@example.com',
    })
    const n = await prismaBase.notification.findUnique({ where: { id: res.body.notificationId } })
    expect(n!.subject).toContain('извлечение')
    expect((n!.meta as { attachments: unknown[] }).attachments).toHaveLength(1)
    await request(server)
      .post(`/api/v1/reports/statement/${bBuildingId}/send`)
      .set(bearer(A.ownerToken))
      .send({})
      .expect(404)
  })
})

describe('demo mode and the demo payment page', () => {
  let linkUrl: string
  let openId: string
  it('the demo provider is refused without demoMode; with it a link is created and the page records a payment', async () => {
    const me = await request(server).get('/api/v1/tenant').set(bearer(A.ownerToken))
    await request(server)
      .patch('/api/v1/tenant')
      .set(bearer(A.ownerToken))
      .send({ settings: { billing: { ...me.body.settings.billing, paymentProvider: 'demo' } } })
      .expect(200)
    openId = (await prismaBase.invoice.findFirst({
      where: { tenantId: A.tenantId, status: { in: ['issued', 'overdue', 'partially_paid'] } },
    }))!.id
    const refused = await request(server)
      .post(`/api/v1/billing/invoices/${openId}/payment-link`)
      .set(bearer(A.ownerToken))
    expect(refused.status).toBe(409)
    expect(refused.body.code).toBe('billing.provider.demoModeOff')
    // Owners cannot switch demoMode on; the platform admin can.
    const adminSet = await request(server)
      .post(`/api/v1/admin/tenants/${A.tenantId}/demo-mode`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ enabled: true })
    expect(adminSet.status, adminSet.text).toBe(200)
    expect(adminSet.body.features.demoMode).toBe(true)
    const link = await request(server)
      .post(`/api/v1/billing/invoices/${openId}/payment-link`)
      .set(bearer(A.ownerToken))
    expect(link.status, link.text).toBe(201)
    expect(link.body.link.provider).toBe('demo')
    linkUrl = link.body.link.url
    expect(linkUrl).toMatch(/\/pay\/demo\/[0-9a-f]{32}$/)
    const path = linkUrl.replace(/^https?:\/\/[^/]+/, '')
    const page = await request(server).get(path)
    expect(page.status).toBe(200)
    expect(page.text).toContain('ДЕМО')
    expect(page.text).toContain('name="cardName"')
    const paid = await request(server)
      .post(path)
      .type('form')
      .send({ cardName: 'Test Card', cardNumber: '4242 4242 4242 4242' })
    expect(paid.status, paid.text).toBe(200)
    const inv = await request(server)
      .get(`/api/v1/billing/invoices/${openId}`)
      .set(bearer(A.ownerToken))
    expect(inv.body.status).toBe('paid')
    expect(inv.body.payments[0]).toMatchObject({ source: 'provider', provider: 'demo' })
    expect(inv.body.paymentLinks[0].status).toBe('paid')
    // Posting twice does not pay twice.
    await request(server).post(path).type('form').send({ cardName: 'Test Card' }).expect(200)
    expect(
      await prismaBase.payment.count({ where: { tenantId: A.tenantId, provider: 'demo' } }),
    ).toBe(1)
    // Demo mode off again: the page is a 404 even for a known token.
    await request(server)
      .post(`/api/v1/admin/tenants/${A.tenantId}/demo-mode`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ enabled: false })
      .expect(200)
    await request(server).get(path).expect(404)
    await request(server).get('/pay/demo/00000000000000000000000000000000').expect(404)
    await request(server).get('/pay/demo/nope').expect(404)
  })
  it('webhooks for the stub providers answer 501 / 404', async () => {
    await request(server)
      .post('/webhooks/payments/stripe')
      .set('Content-Type', 'application/json')
      .send('{}')
      .expect(501)
    await request(server).post('/webhooks/payments/paypal').send('{}').expect(404)
  })
  it('the admin generates a year of demo data for an empty tenant; reset requires demoMode', async () => {
    const C = await createTenant(server, 'Demo C')
    const r = await request(server)
      .post(`/api/v1/admin/tenants/${C.tenantId}/demo-data`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ months: 4 })
    expect(r.status, r.text).toBe(200)
    expect(r.body.registryCreated).toBe(true)
    expect(r.body.skipped).toBe(false)
    expect(r.body.counts.buildings).toBe(12)
    expect(r.body.counts.elevators).toBe(20)
    expect(r.body.counts.visits).toBeGreaterThan(50)
    expect(r.body.counts.callbacks).toBeGreaterThan(5)
    expect(r.body.counts.invoices).toBeGreaterThan(20)
    expect(r.body.counts.payments).toBeGreaterThan(10)
    expect(r.body.counts.bankImports).toBe(1)
    expect(r.body.counts.attachments).toBeGreaterThan(0)
    // Nothing generated reached an inbox as news: every event is acknowledged.
    const pending = await prismaBase.eventDelivery.count({
      where: {
        status: 'pending',
        eventId: {
          in: (
            await prismaBase.domainEvent.findMany({
              where: { tenantId: C.tenantId },
              select: { id: true },
            })
          ).map((e) => e.id),
        },
      },
    })
    expect(pending).toBe(0)
    const invoices = await request(server)
      .get('/api/v1/billing/invoices')
      .query({ limit: 200 })
      .set(bearer(C.ownerToken))
    const statuses = new Set(invoices.body.items.map((i: { status: string }) => i.status))
    expect(statuses.has('paid')).toBe(true)
    expect(statuses.has('overdue')).toBe(true)
    expect(invoices.body.items.some((i: { dunningStage: number }) => i.dunningStage > 0)).toBe(true)
    expect(
      invoices.body.items.every((i: { paymentReference: string }) =>
        /^AE-\d{4}-\d{6}$/.test(i.paymentReference),
      ),
    ).toBe(true)
    // Second run is a no-op.
    const again = await request(server)
      .post(`/api/v1/admin/tenants/${C.tenantId}/demo-data`)
      .set('Authorization', `Bearer ${admin}`)
      .send({})
    expect(again.body.skipped).toBe(true)
    await request(server)
      .post(`/api/v1/admin/tenants/${C.tenantId}/demo-data`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ reset: true })
      .expect(409)
    await expect(resetDemoTenant(C.tenantId)).rejects.toThrow(/demo mode/)
    // Tenant A's data is untouched by C's generation.
    expect(await prismaBase.building.count({ where: { tenantId: A.tenantId } })).toBe(3)
    // With demoMode on, the nightly reset purges operational data and regenerates it; registry stays.
    await request(server)
      .post(`/api/v1/admin/tenants/${C.tenantId}/demo-mode`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ enabled: true })
      .expect(200)
    const firstInvoice = await prismaBase.invoice.findFirst({ where: { tenantId: C.tenantId } })
    const job = (await runJob('tenancy.demoReset')) as Record<
      string,
      { files?: number; error?: string }
    >
    expect(job[C.tenantId]?.error).toBeUndefined()
    expect(await prismaBase.invoice.findUnique({ where: { id: firstInvoice!.id } })).toBeNull()
    expect(await prismaBase.building.count({ where: { tenantId: C.tenantId } })).toBe(12)
    expect(await prismaBase.invoice.count({ where: { tenantId: C.tenantId } })).toBeGreaterThan(20)
    expect(
      await prismaBase.auditLog.count({
        where: { tenantId: C.tenantId, action: 'tenant.demoReset' },
      }),
    ).toBe(1)
    await request(server).get('/api/v1/billing/invoices').set(bearer(C.ownerToken)).expect(200)
  }, 120_000)
  it('generateDemoData on a tenant with its own registry adds operational data only', async () => {
    const D = await createTenant(server, 'Own registry D')
    const cust = await createCustomer(server, D.ownerToken, 'ЕС „Своя“')
    const b = await createBuilding(server, D.ownerToken, 'ж.к. Своя', '1')
    const e = await createElevator(server, D.ownerToken, b.id)
    await request(server)
      .post('/api/v1/contracts')
      .set(bearer(D.ownerToken))
      .send({
        customerId: cust.id,
        buildingId: b.id,
        startDate: '2025-06-01',
        lines: [{ elevatorId: e.id, monthlyPriceCents: 4000 }],
      })
      .expect(201)
    const r = await generateDemoData(D.tenantId, { months: 3 })
    expect(r.registryCreated).toBe(false)
    expect(r.counts.buildings).toBeUndefined()
    expect(await prismaBase.building.count({ where: { tenantId: D.tenantId } })).toBe(1)
    expect(await prismaBase.visit.count({ where: { tenantId: D.tenantId } })).toBeGreaterThan(0)
    expect(await prismaBase.invoice.count({ where: { tenantId: D.tenantId } })).toBe(3)
  }, 60_000)
})

describe('tenant isolation and roles for every new endpoint', () => {
  it('B answers 404 on A resources; a technician gets 403', async () => {
    const inv = (await prismaBase.invoice.findFirst({ where: { tenantId: A.tenantId } }))!
    const imp = (await prismaBase.bankImport.findFirst({ where: { tenantId: A.tenantId } }))!
    const row = (await prismaBase.bankImportRow.findFirst({ where: { tenantId: A.tenantId } }))!
    const b = bearer(B.ownerToken)
    await request(server).get(`/api/v1/billing/invoices/${inv.id}`).set(b).expect(404)
    await request(server)
      .post(`/api/v1/billing/invoices/${inv.id}/credit-notes`)
      .set(b)
      .send({ reason: 'xx' })
      .expect(404)
    await request(server).get(`/api/v1/billing/invoices/${inv.id}/credit-notes`).set(b).expect(404)
    await request(server).post(`/api/v1/billing/invoices/${inv.id}/payment-link`).set(b).expect(404)
    await request(server)
      .post(`/api/v1/billing/invoices/${inv.id}/pay`)
      .set(b)
      .send({ paidAt: today })
      .expect(404)
    await request(server).get(`/api/v1/billing/bank-imports/${imp.id}`).set(b).expect(404)
    await request(server)
      .put(`/api/v1/billing/bank-imports/${imp.id}/rows/${row.id}`)
      .set(b)
      .send({})
      .expect(404)
    await request(server).post(`/api/v1/billing/bank-imports/${imp.id}/commit`).set(b).expect(404)
    await request(server).get(`/api/v1/buildings/${buildingId}/statement`).set(b).expect(404)
    await request(server).get(`/print/statement/${buildingId}`).set(b).expect(404)
    await request(server)
      .post(`/api/v1/reports/statement/${buildingId}/send`)
      .set(b)
      .send({})
      .expect(404)
    const bulk = await request(server)
      .post('/api/v1/billing/invoices/bulk')
      .set(b)
      .send({ action: 'pay', ids: [inv.id] })
    expect(bulk.body).toMatchObject({ done: 0, skipped: 1 })
    expect(
      (await request(server).get('/api/v1/billing/bank-imports').set(b)).body.items,
    ).toHaveLength(0)
    // B's own config / stages never see A's customisation.
    const cfg = await request(server).get('/api/v1/billing/config').set(b)
    expect(cfg.body.stagesCustomised).toBe(false)
    const rules = await request(server).get('/api/v1/billing/config').set(b)
    expect(rules.body.lateFeeRules[0].enabled).toBe(false)

    const tech = await request(server)
      .post('/api/v1/users')
      .set(bearer(A.ownerToken))
      .send({
        username: `tech7_${Date.now() % 100000}`,
        password: 'password123',
        name: 'Монтьор',
        role: 'technician',
      })
    expect(tech.status, tech.text).toBe(201)
    const login = await request(server)
      .post('/api/v1/auth/login')
      .set(CSRF)
      .send({ username: tech.body.username, password: 'password123' })
    const t = bearer(login.body.token)
    for (const path of [
      '/api/v1/billing/config',
      '/api/v1/billing/invoices',
      `/api/v1/billing/invoices/${inv.id}`,
      '/api/v1/billing/bank-imports',
      '/api/v1/billing/dunning/preview',
      `/api/v1/buildings/${buildingId}/statement`,
    ]) {
      await request(server).get(path).set(t).expect(403)
    }
    await request(server)
      .put('/api/v1/billing/dunning-stages')
      .set(t)
      .send({ stages: [] })
      .expect(403)
    await request(server).get(`/print/invoice/${inv.id}`).set(t).expect(403)
  })
})
