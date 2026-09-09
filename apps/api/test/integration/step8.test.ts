import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import request from 'supertest'
import type { Express } from 'express'
import { disconnectDb, prismaBase } from '../../src/platform/db/prisma.js'
import { runJob } from '../../src/platform/jobs/registry.js'
import { registerSubscribers } from '../../src/subscribers.js'
import { ensureJobsRegistered } from '../../src/worker.js'
import { checklists } from '../../src/modules/maintenance/index.js'
import * as notifications from '../../src/modules/notifications/index.js'
import * as billing from '../../src/modules/billing/index.js'
import * as jobs from '../../src/modules/jobs/index.js'
import {
  CSRF,
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
let customerId: string
let buildingId: string
let elevatorId: string
let bElevatorId: string
let techId: string
let techToken: string
let officeToken: string
let defectId: string
let jobId: string

const techHeaders = () => ({ ...bearer(techToken), 'X-Client': 'app', 'X-Client-Version': '0.4.0' })
const LAT = 42.6501
const LNG = 23.3771

beforeAll(async () => {
  await resetDb()
  await seedAdmin()
  await checklists.ensureSystemTemplates()
  await notifications.ensureSystemTemplates()
  await billing.ensureSystemBillingDefaults()
  await jobs.ensureSystemJobStages()
  registerSubscribers()
  ensureJobsRegistered()
  server = app()
  A = await createTenant(server, 'Jobs A')
  B = await createTenant(server, 'Jobs B')
  customerId = (await createCustomer(server, A.ownerToken, 'ЕС „Младост 25“')).id
  const b = await request(server)
    .post('/api/v1/buildings')
    .set(bearer(A.ownerToken))
    .send({
      customerId,
      address: { city: 'София', district: 'ж.к. Младост 1', block: '25', entrance: 'А' },
      lat: LAT,
      lng: LNG,
    })
  expect(b.status, b.text).toBe(201)
  buildingId = b.body.id
  elevatorId = (await createElevator(server, A.ownerToken, buildingId)).id
  bElevatorId = (
    await createElevator(
      server,
      B.ownerToken,
      (await createBuilding(server, B.ownerToken, 'ж.к. Дружба', '9')).id,
    )
  ).id
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
  const techUsername = `ivan8_${Date.now() % 100000}`
  const tech = await request(server).post('/api/v1/users').set(bearer(A.ownerToken)).send({
    username: techUsername,
    password: 'password123',
    name: 'Иван Монтьор',
    role: 'technician',
  })
  expect(tech.status, tech.text).toBe(201)
  techId = tech.body.id
  const techLogin = await request(server)
    .post('/api/v1/auth/login')
    .set(CSRF)
    .send({ username: techUsername, password: 'password123' })
  expect(techLogin.status, techLogin.text).toBe(200)
  techToken = techLogin.body.token
  const officeUsername = `maria8_${Date.now() % 100000}`
  await request(server)
    .post('/api/v1/users')
    .set(bearer(A.ownerToken))
    .send({ username: officeUsername, password: 'password123', name: 'Мария', role: 'office' })
    .expect(201)
  const officeLogin = await request(server)
    .post('/api/v1/auth/login')
    .set(CSRF)
    .send({ username: officeUsername, password: 'password123' })
  officeToken = officeLogin.body.token
  await request(server).get('/api/v1/notifications/rules').set(bearer(A.ownerToken)).expect(200)
  const settings = await request(server)
    .patch('/api/v1/tenant')
    .set(bearer(A.ownerToken))
    .send({
      features: { publicQrPage: true },
      settings: {
        billing: {
          bank: {
            beneficiary: 'Тест Лифт ЕООД',
            iban: 'BG80 BNBG 9661 1020 3456 78',
            bic: 'BNBGBGSD',
            bankName: 'БНБ',
          },
        },
      },
    })
  expect(settings.status, settings.text).toBe(200)
})

afterAll(async () => {
  await disconnectDb()
})

describe('Task A: quick fixes', () => {
  it('showPaymentOnPublicPage is OFF by default', async () => {
    const me = await request(server).get('/api/v1/tenant').set(bearer(A.ownerToken))
    expect(me.body.settings.billing.showPaymentOnPublicPage).toBe(false)
    expect(me.body.settings.jobs).toEqual({
      approvalReminderDays: 14,
      defaultWarrantyMonths: 12,
      quoteValidDays: 30,
    })
  })

  it('billing.issueInvoice creates a numbered invoice without a contract', async () => {
    const { systemCtx } = await import('../../src/platform/http/ctx.js')
    const ctx = { ...systemCtx(A.tenantId), userId: '' }
    const inv = await billing.issueInvoice(ctx, {
      sourceType: 'job',
      sourceId: randomUUID(),
      buildingId,
      customerId,
      lines: [{ elevatorId, description: 'Тест', amountCents: 1000 }],
    })
    expect(inv.contractId).toBeNull()
    expect(inv.number).toBe(1)
    expect(inv.vatCents).toBe(200)
    expect(inv.totalCents).toBe(1200)
    expect(inv.paymentReference).toMatch(/^AE-\d{4}-000001$/)
    expect(inv.sourceType).toBe('job')
    // The list works with a NULL contract (customer name comes from the customer itself).
    const list = await request(server).get('/api/v1/billing/invoices').set(bearer(A.ownerToken))
    expect(list.status).toBe(200)
    expect(list.body.items[0].customerName).toBe('ЕС „Младост 25“')
    // Rows without a contract cannot collide on (tenant, contract, period): a second one is fine.
    const again = await billing.issueInvoice(ctx, {
      sourceType: 'job',
      sourceId: randomUUID(),
      buildingId,
      customerId,
      lines: [{ elevatorId, description: 'Тест 2', amountCents: 500 }],
    })
    expect(again.number).toBe(2)
  })
})

describe('jobs: config and stages as data', () => {
  it('GET /jobs/config returns the system stages and settings; technicians may read it', async () => {
    const res = await request(server).get('/api/v1/jobs/config').set(bearer(A.ownerToken))
    expect(res.status, res.text).toBe(200)
    expect(res.body.stages.map((s: { code: string }) => s.code)).toEqual([
      'draft',
      'quoted',
      'awaiting_approval',
      'approved',
      'scheduled',
      'in_progress',
      'done',
      'invoiced',
      'rejected',
      'cancelled',
    ])
    expect(res.body.stagesCustomised).toBe(false)
    expect(res.body.approvalReminderDays).toBe(14)
    expect(
      res.body.stages.find((s: { code: string }) => s.code === 'approved').requiresEvidence,
    ).toBe(true)
    await request(server).get('/api/v1/jobs/config').set(techHeaders()).expect(200)
  })

  it('owner overrides the list (validation, office 403, empty list = default)', async () => {
    const cfg = await request(server).get('/api/v1/jobs/config').set(bearer(A.ownerToken))
    const stages = cfg.body.stages.map((s: Record<string, unknown>) => ({
      code: s.code,
      bg: (s.label as { bg: string }).bg,
      en: (s.label as { en: string }).en,
      isTerminal: s.isTerminal,
      allowedNext: s.allowedNext,
      requiresEvidence: s.requiresEvidence,
    }))
    const custom = [
      ...stages.map((s: { code: string; allowedNext: string[] }) =>
        s.code === 'approved'
          ? { ...s, allowedNext: ['parts_ordered', 'scheduled', 'cancelled'] }
          : s,
      ),
      {
        code: 'parts_ordered',
        bg: 'Поръчани части',
        en: 'Parts ordered',
        isTerminal: false,
        allowedNext: ['scheduled'],
        requiresEvidence: false,
      },
    ]
    await request(server)
      .put('/api/v1/jobs/stages')
      .set(bearer(officeToken))
      .send({ stages: custom })
      .expect(403)
    const bad = await request(server)
      .put('/api/v1/jobs/stages')
      .set(bearer(A.ownerToken))
      .send({ stages: custom.filter((s: { code: string }) => s.code !== 'done') })
    expect(bad.status).toBe(400)
    expect(bad.body.code).toBe('jobs.stages.missingRequired')
    const ok = await request(server)
      .put('/api/v1/jobs/stages')
      .set(bearer(A.ownerToken))
      .send({ stages: custom })
    expect(ok.status, ok.text).toBe(200)
    expect(ok.body.stages).toHaveLength(11)
    const after = await request(server).get('/api/v1/jobs/config').set(bearer(A.ownerToken))
    expect(after.body.stagesCustomised).toBe(true)
    // Tenant B is untouched.
    const bCfg = await request(server).get('/api/v1/jobs/config').set(bearer(B.ownerToken))
    expect(bCfg.body.stages).toHaveLength(10)
    await request(server)
      .put('/api/v1/jobs/stages')
      .set(bearer(A.ownerToken))
      .send({ stages: [] })
      .expect(200)
    const reset = await request(server).get('/api/v1/jobs/config').set(bearer(A.ownerToken))
    expect(reset.body.stagesCustomised).toBe(false)
    expect(reset.body.stages).toHaveLength(10)
  })
})

describe('jobs: create -> quote -> approve with evidence -> schedule -> complete -> invoice', () => {
  it('creates a job from a defect with lines; totals and VAT are computed', async () => {
    const d = await request(server)
      .post('/api/v1/defects')
      .set(bearer(A.ownerToken))
      .send({ elevatorId, catalogCode: 'other', description: 'Износени ролки', stopLift: false })
    expect(d.status, d.text).toBe(201)
    defectId = d.body.id
    const res = await request(server)
      .post('/api/v1/jobs')
      .set(bearer(officeToken))
      .send({
        elevatorId,
        title: 'Смяна на ролки на кабинните врати',
        description: 'Вратите заяждат.',
        originType: 'defect',
        originId: defectId,
        lines: [
          { kind: 'part', description: 'Ролка Ø60', qty: 4, unitCents: 2850, partRef: 'RL-60' },
          { kind: 'labour', description: 'Труд', qty: 2.5, unitCents: 4500 },
        ],
      })
    expect(res.status, res.text).toBe(201)
    jobId = res.body.id
    expect(res.body).toMatchObject({
      status: 'draft',
      isTerminal: false,
      customerId,
      customerName: 'ЕС „Младост 25“',
      buildingId,
      elevatorInternalNo: 'вх. А',
      originType: 'defect',
      originId: defectId,
      quoteVersion: 1,
      netCents: 11400 + 11250,
      vatCents: Math.round(22650 * 0.2),
      totalCents: 22650 + 4530,
      vatRatePercent: 20,
      lineCount: 2,
    })
    const byOrigin = await request(server)
      .get(`/api/v1/jobs/by-origin?originType=defect&ids=${defectId}`)
      .set(bearer(A.ownerToken))
    expect(byOrigin.body.items[defectId]).toMatchObject({ id: jobId, status: 'draft' })
    // Technicians cannot create jobs.
    await request(server)
      .post('/api/v1/jobs')
      .set(techHeaders())
      .send({ elevatorId, title: 'x' })
      .expect(403)
  })

  it('edits lines while the quote is open; totals follow', async () => {
    const added = await request(server)
      .post(`/api/v1/jobs/${jobId}/lines`)
      .set(bearer(A.ownerToken))
      .send({ kind: 'other', description: 'Транспорт', qty: 1, unitCents: 1500 })
    expect(added.status, added.text).toBe(201)
    expect(added.body.lines).toHaveLength(3)
    expect(added.body.netCents).toBe(22650 + 1500)
    const lineId = added.body.lines[2].id
    const upd = await request(server)
      .patch(`/api/v1/jobs/${jobId}/lines/${lineId}`)
      .set(bearer(A.ownerToken))
      .send({ unitCents: 2000 })
    expect(upd.body.netCents).toBe(22650 + 2000)
    const del = await request(server)
      .delete(`/api/v1/jobs/${jobId}/lines/${lineId}`)
      .set(bearer(A.ownerToken))
    expect(del.status).toBe(200)
    expect(del.body.lines).toHaveLength(2)
    expect(del.body.netCents).toBe(22650)
  })

  it('quote -> send by e-mail: awaiting_approval, notification with the document attached, print page', async () => {
    const quoted = await request(server)
      .post(`/api/v1/jobs/${jobId}/quote`)
      .set(bearer(A.ownerToken))
    expect(quoted.status, quoted.text).toBe(200)
    expect(quoted.body.status).toBe('quoted')
    const sent = await request(server)
      .post(`/api/v1/jobs/${jobId}/send-quote`)
      .set(bearer(A.ownerToken))
      .send({ channel: 'email', email: 'petya@example.com', message: 'Моля за отговор до петък.' })
    expect(sent.status, sent.text).toBe(200)
    expect(sent.body.job.status).toBe('awaiting_approval')
    expect(sent.body.job.quoteSentAt).toBeTruthy()
    expect(sent.body.job.quoteValidUntil).toBeTruthy()
    expect(sent.body.notificationId).toBeTruthy()
    expect(sent.body.printUrl).toBe(`/print/quote/${jobId}`)
    const n = await prismaBase.notification.findUnique({ where: { id: sent.body.notificationId } })
    expect(n?.relatedType).toBe('job')
    expect(n?.relatedId).toBe(jobId)
    expect(n?.channel).toBe('email')
    expect(n?.to).toBe('petya@example.com')
    expect(n?.subject).toContain('Смяна на ролки')
    expect(JSON.stringify(n?.meta)).toContain('oferta-')
    const print = await request(server).get(`/print/quote/${jobId}`).set(bearer(A.ownerToken))
    expect(print.status).toBe(200)
    expect(print.text).toContain('Ролка Ø60')
    expect(print.text).toContain('ж.к. Младост 1')
    await request(server).get(`/print/quote/${jobId}`).set(bearer(B.ownerToken)).expect(404)
    // Viber link: a notification row with the deep link the office user taps.
    const viber = await request(server)
      .post(`/api/v1/jobs/${jobId}/send-quote`)
      .set(bearer(A.ownerToken))
      .send({ channel: 'viber', phone: '0888 123 456' })
    expect(viber.status, viber.text).toBe(200)
    expect(viber.body.viber.url).toContain('viber://')
    expect(viber.body.viber.text).toContain('оферта')
  })

  it('approval needs evidence; lines lock afterwards', async () => {
    const noEvidence = await request(server)
      .post(`/api/v1/jobs/${jobId}/transition`)
      .set(bearer(A.ownerToken))
      .send({ to: 'approved' })
    expect(noEvidence.status).toBe(400)
    expect(noEvidence.body.code).toBe('jobs.evidenceRequired')
    const bad = await request(server)
      .post(`/api/v1/jobs/${jobId}/transition`)
      .set(bearer(A.ownerToken))
      .send({ to: 'done' })
    expect(bad.status).toBe(409)
    const ok = await request(server)
      .post(`/api/v1/jobs/${jobId}/transition`)
      .set(bearer(A.ownerToken))
      .send({
        to: 'approved',
        evidence: { kind: 'assembly_protocol', by: 'ОС на ЕС', note: 'Протокол № 12 от 1.09.2026' },
      })
    expect(ok.status, ok.text).toBe(200)
    expect(ok.body.status).toBe('approved')
    expect(ok.body.approvalEvidence).toMatchObject({ kind: 'assembly_protocol', by: 'ОС на ЕС' })
    expect(ok.body.approvedAt).toBeTruthy()
    const locked = await request(server)
      .post(`/api/v1/jobs/${jobId}/lines`)
      .set(bearer(A.ownerToken))
      .send({ description: 'късно', qty: 1, unitCents: 100 })
    expect(locked.status).toBe(409)
    expect(locked.body.code).toBe('jobs.linesLocked')
    expect(
      await prismaBase.domainEvent.count({
        where: { tenantId: A.tenantId, type: 'JobApproved', aggregateId: jobId },
      }),
    ).toBe(1)
  })

  it('schedule with the technician pair; the technician sees the job, others do not', async () => {
    const wrongUser = await request(server)
      .post(`/api/v1/jobs/${jobId}/schedule`)
      .set(bearer(A.ownerToken))
      .send({ scheduledAt: '2026-09-15T09:00:00+03:00', assignedUserIds: [randomUUID()] })
    expect(wrongUser.status).toBe(400)
    const res = await request(server)
      .post(`/api/v1/jobs/${jobId}/schedule`)
      .set(bearer(A.ownerToken))
      .send({ scheduledAt: '2026-09-15T09:00:00+03:00', assignedUserIds: [techId] })
    expect(res.status, res.text).toBe(200)
    expect(res.body.status).toBe('scheduled')
    expect(res.body.assignedUserNames).toEqual(['Иван Монтьор'])
    const mine = await request(server).get('/api/v1/jobs?open=true').set(techHeaders())
    expect(mine.status).toBe(200)
    expect(mine.body.items.map((j: { id: string }) => j.id)).toEqual([jobId])
    const detail = await request(server).get(`/api/v1/jobs/${jobId}`).set(techHeaders())
    expect(detail.status).toBe(200)
    expect(detail.body.lines).toHaveLength(2)
    const pull = await request(server).get('/api/v1/sync/pull').set(techHeaders())
    expect(pull.status).toBe(200)
    expect(pull.body.repairJobs.map((j: { id: string }) => j.id)).toEqual([jobId])
    const summary = await request(server).get('/api/v1/jobs/summary').set(bearer(A.ownerToken))
    expect(
      summary.body.scheduledThisWeek.count + summary.body.openQuotes.count,
    ).toBeGreaterThanOrEqual(0)
    await request(server).get('/api/v1/jobs/summary').set(techHeaders()).expect(403)
  })

  it('technician pushes start and complete through the outbox; replay is idempotent; a repair visit appears', async () => {
    const startItem = {
      id: randomUUID(),
      kind: 'job.event',
      schemaVersion: 1,
      payload: {
        jobId,
        type: 'start',
        at: '2026-09-08T09:05:00+03:00',
        clientOffsetMs: 200,
        timestampSource: 'device',
        notes: 'Започваме демонтажа.',
      },
    }
    const started = await request(server)
      .post('/api/v1/sync/push')
      .set(techHeaders())
      .set('Idempotency-Key', startItem.id)
      .send(startItem)
    expect(started.status, started.text).toBe(200)
    expect(started.body.result.status).toBe('in_progress')
    expect(started.body.result.startedAt).toBe('2026-09-08T06:05:00.000Z')
    const replay = await request(server)
      .post('/api/v1/sync/push')
      .set(techHeaders())
      .set('Idempotency-Key', startItem.id)
      .send(startItem)
    expect(replay.status).toBe(200)
    expect(replay.headers['idempotency-replayed']).toBe('true')
    const visitId = randomUUID()
    const photoId = randomUUID()
    const completeItem = {
      id: randomUUID(),
      kind: 'job.event',
      schemaVersion: 1,
      payload: {
        jobId,
        type: 'complete',
        at: '2026-09-08T12:40:00+03:00',
        clientOffsetMs: 200,
        timestampSource: 'device',
        notes: 'Сменени 4 ролки, вратите регулирани.',
        partsUsed: 'Ролка Ø60 × 4',
        visitId,
        attachments: [{ id: photoId, role: 'photo' }],
      },
    }
    const done = await request(server)
      .post('/api/v1/sync/push')
      .set(techHeaders())
      .set('Idempotency-Key', completeItem.id)
      .send(completeItem)
    expect(done.status, done.text).toBe(200)
    expect(done.body.result.status).toBe('done')
    expect(done.body.result.visitId).toBe(visitId)
    expect(done.body.result.completedAt).toBe('2026-09-08T09:40:00.000Z')
    expect(done.body.result.warrantyUntil).toBe('2027-09-08')
    // Same completion from a new outbox row (the phone re-sent after a crash): no second visit.
    const again = { ...completeItem, id: randomUUID() }
    const r2 = await request(server)
      .post('/api/v1/sync/push')
      .set(techHeaders())
      .set('Idempotency-Key', again.id)
      .send(again)
    expect(r2.status, r2.text).toBe(200)
    expect(r2.body.result.status).toBe('done')
    expect(await prismaBase.visit.count({ where: { tenantId: A.tenantId, kind: 'repair' } })).toBe(
      1,
    )
    const visits = await request(server)
      .get(`/api/v1/elevators/${elevatorId}/visits`)
      .set(bearer(A.ownerToken))
    const repair = visits.body.items.find((v: { id: string }) => v.id === visitId)
    expect(repair).toBeTruthy()
    expect(repair.kind).toBe('repair')
    expect(repair.source).toBe('app')
    expect(repair.technicians.map((t: { name: string }) => t.name)).toEqual(['Иван Монтьор'])
    expect(repair.notes).toContain('Смяна на ролки')
    expect(repair.attachments).toEqual([
      { attachmentId: photoId, role: 'photo', uploaded: false, attachment: null },
    ])
    const detail = await request(server).get(`/api/v1/jobs/${jobId}`).set(bearer(A.ownerToken))
    expect(
      detail.body.events.map(
        (e: { type: string; toStatus: string | null }) => e.toStatus ?? e.type,
      ),
    ).toEqual(
      expect.arrayContaining([
        'draft',
        'quoted',
        'awaiting_approval',
        'approved',
        'scheduled',
        'in_progress',
        'done',
      ]),
    )
    const fromApp = detail.body.events.find(
      (e: { toStatus: string | null }) => e.toStatus === 'done',
    )
    expect(fromApp.source).toBe('app')
    expect(fromApp.byUserId).toBe(techId)
  })

  it('done-not-invoiced shows the value; invoicing creates the invoice through billing', async () => {
    const before = await request(server).get('/api/v1/jobs/summary').set(bearer(A.ownerToken))
    expect(before.body.doneNotInvoiced).toEqual({ count: 1, cents: 22650 })
    const res = await request(server)
      .post(`/api/v1/jobs/${jobId}/invoice`)
      .set(bearer(A.ownerToken))
      .send({ kind: 'full' })
    expect(res.status, res.text).toBe(200)
    expect(res.body.status).toBe('invoiced')
    expect(res.body.isTerminal).toBe(true)
    expect(res.body.invoicedCents).toBe(22650)
    expect(res.body.invoices).toHaveLength(1)
    const inv = await request(server)
      .get(`/api/v1/billing/invoices/${res.body.invoiceId}`)
      .set(bearer(A.ownerToken))
    expect(inv.status).toBe(200)
    expect(inv.body).toMatchObject({
      contractId: null,
      sourceType: 'job',
      sourceId: jobId,
      jobId,
      amountCents: 22650,
      vatCents: 4530,
      totalCents: 27180,
      status: 'issued',
      customerId,
    })
    expect(inv.body.lines).toEqual([
      { elevatorId, description: 'Ролка Ø60 × 4', amountCents: 11400 },
      { elevatorId, description: 'Труд × 2.5', amountCents: 11250 },
    ])
    const after = await request(server).get('/api/v1/jobs/summary').set(bearer(A.ownerToken))
    expect(after.body.doneNotInvoiced).toEqual({ count: 0, cents: 0 })
    await request(server)
      .post(`/api/v1/jobs/${jobId}/invoice`)
      .set(bearer(A.ownerToken))
      .send({ kind: 'full' })
      .expect(409)
    // The invoice list and the elevator's billing work with the contract-less row.
    const list = await request(server)
      .get(`/api/v1/billing/invoices?buildingId=${buildingId}`)
      .set(bearer(A.ownerToken))
    expect(list.body.items.some((i: { id: string }) => i.id === res.body.invoiceId)).toBe(true)
    const printInv = await request(server)
      .get(`/print/invoice/${res.body.invoiceId}`)
      .set(bearer(A.ownerToken))
    expect(printInv.status).toBe(200)
  })

  it('the public QR page hides the arrears by default and shows them only when the firm opts in', async () => {
    const e = await request(server).get(`/api/v1/elevators/${elevatorId}`).set(bearer(A.ownerToken))
    const token = e.body.publicUrl.split('/p/')[1]
    const off = await request(server).get(`/p/${token}`)
    expect(off.status).toBe(200)
    expect(off.text).not.toContain('BG80 BNBG')
    const me = await request(server).get('/api/v1/tenant').set(bearer(A.ownerToken))
    await request(server)
      .patch('/api/v1/tenant')
      .set(bearer(A.ownerToken))
      .send({
        settings: { billing: { ...me.body.settings.billing, showPaymentOnPublicPage: true } },
      })
      .expect(200)
    const on = await request(server).get(`/p/${token}`)
    expect(on.text).toContain('BG80 BNBG 9661 1020 3456 78')
    await request(server)
      .patch('/api/v1/tenant')
      .set(bearer(A.ownerToken))
      .send({
        settings: { billing: { ...me.body.settings.billing, showPaymentOnPublicPage: false } },
      })
      .expect(200)
  })
})

describe('jobs: rejected path, revision, deposits, reminders', () => {
  let job2: string
  let job3: string

  it('rejected with a reason; a revision starts version 2 with the old lines kept as history', async () => {
    const created = await request(server)
      .post('/api/v1/jobs')
      .set(bearer(A.ownerToken))
      .send({
        elevatorId,
        title: 'Смяна на буфери',
        lines: [{ kind: 'part', description: 'Буфер', qty: 2, unitCents: 8800 }],
      })
    job2 = created.body.id
    const sent = await request(server)
      .post(`/api/v1/jobs/${job2}/send-quote`)
      .set(bearer(A.ownerToken))
      .send({ channel: 'none' })
    expect(sent.status, sent.text).toBe(200)
    expect(sent.body.job.status).toBe('awaiting_approval')
    const noReason = await request(server)
      .post(`/api/v1/jobs/${job2}/reject`)
      .set(bearer(A.ownerToken))
      .send({})
    expect(noReason.status).toBe(400)
    const rejected = await request(server)
      .post(`/api/v1/jobs/${job2}/reject`)
      .set(bearer(A.ownerToken))
      .send({ reason: 'Прекалено скъпо за сградата.' })
    expect(rejected.status, rejected.text).toBe(200)
    expect(rejected.body.status).toBe('rejected')
    expect(rejected.body.isTerminal).toBe(true)
    expect(rejected.body.rejectedReason).toBe('Прекалено скъпо за сградата.')
    expect(
      await prismaBase.domainEvent.count({
        where: { tenantId: A.tenantId, type: 'JobRejected', aggregateId: job2 },
      }),
    ).toBe(1)
    const revised = await request(server)
      .post(`/api/v1/jobs/${job2}/revise`)
      .set(bearer(A.ownerToken))
      .send({ reason: 'Нова оферта с по-евтини буфери' })
    expect(revised.status, revised.text).toBe(200)
    expect(revised.body.status).toBe('draft')
    expect(revised.body.quoteVersion).toBe(2)
    const detail = await request(server).get(`/api/v1/jobs/${job2}`).set(bearer(A.ownerToken))
    expect(detail.body.lines).toHaveLength(1)
    expect(detail.body.lines[0].quoteVersion).toBe(2)
    expect(detail.body.previousLines).toHaveLength(1)
    expect(detail.body.previousLines[0].quoteVersion).toBe(1)
    const cheaper = await request(server)
      .patch(`/api/v1/jobs/${job2}/lines/${detail.body.lines[0].id}`)
      .set(bearer(A.ownerToken))
      .send({ unitCents: 6000 })
    expect(cheaper.body.netCents).toBe(12000)
    expect(cheaper.body.previousLines[0].unitCents).toBe(8800)
    // An empty draft cannot be quoted.
    const empty = await request(server)
      .post('/api/v1/jobs')
      .set(bearer(A.ownerToken))
      .send({ elevatorId, title: 'Празна' })
    const noLines = await request(server)
      .post(`/api/v1/jobs/${empty.body.id}/quote`)
      .set(bearer(A.ownerToken))
    expect(noLines.status).toBe(409)
    expect(noLines.body.code).toBe('jobs.noLines')
    const cancelled = await request(server)
      .post(`/api/v1/jobs/${empty.body.id}/cancel`)
      .set(bearer(A.ownerToken))
      .send({ reason: 'дубликат' })
    expect(cancelled.body.status).toBe('cancelled')
  })

  it('a deposit invoice before the work, the final invoice deducts it', async () => {
    const created = await request(server)
      .post('/api/v1/jobs')
      .set(bearer(A.ownerToken))
      .send({
        elevatorId,
        kind: 'modernisation',
        title: 'Честотен регулатор',
        lines: [
          { kind: 'part', description: 'Честотен регулатор 7.5 kW', qty: 1, unitCents: 189000 },
          { kind: 'labour', description: 'Монтаж', qty: 16, unitCents: 4500 },
        ],
      })
    job3 = created.body.id
    const tooEarly = await request(server)
      .post(`/api/v1/jobs/${job3}/invoice`)
      .set(bearer(A.ownerToken))
      .send({ kind: 'partial', amountCents: 50000 })
    expect(tooEarly.status).toBe(409)
    await request(server)
      .post(`/api/v1/jobs/${job3}/send-quote`)
      .set(bearer(A.ownerToken))
      .send({ channel: 'none' })
      .expect(200)
    await request(server)
      .post(`/api/v1/jobs/${job3}/transition`)
      .set(bearer(A.ownerToken))
      .send({ to: 'approved', evidence: { kind: 'email', by: 'Петя Димова' } })
      .expect(200)
    const deposit = await request(server)
      .post(`/api/v1/jobs/${job3}/invoice`)
      .set(bearer(A.ownerToken))
      .send({ kind: 'partial', amountCents: 100000, description: 'Аванс 100000' })
    expect(deposit.status, deposit.text).toBe(200)
    expect(deposit.body.status).toBe('approved')
    expect(deposit.body.invoicedCents).toBe(100000)
    expect(deposit.body.invoices).toHaveLength(1)
    expect(deposit.body.invoices[0].totalCents).toBe(120000)
    // Office completes (createVisit false: nothing on site yet in this test) and invoices the rest.
    const done = await request(server)
      .post(`/api/v1/jobs/${job3}/complete`)
      .set(bearer(A.ownerToken))
      .send({ createVisit: false, warrantyMonths: 24, technicianUserIds: [techId] })
    expect(done.status, done.text).toBe(200)
    expect(done.body.status).toBe('done')
    expect(done.body.visitId).toBeNull()
    const summary = await request(server).get('/api/v1/jobs/summary').set(bearer(A.ownerToken))
    expect(summary.body.doneNotInvoiced).toEqual({ count: 1, cents: 189000 + 72000 - 100000 })
    const final = await request(server)
      .post(`/api/v1/jobs/${job3}/invoice`)
      .set(bearer(A.ownerToken))
      .send({ kind: 'full' })
    expect(final.status, final.text).toBe(200)
    expect(final.body.status).toBe('invoiced')
    expect(final.body.invoicedCents).toBe(261000)
    expect(final.body.invoices).toHaveLength(2)
    const inv = await request(server)
      .get(`/api/v1/billing/invoices/${final.body.invoiceId}`)
      .set(bearer(A.ownerToken))
    expect(inv.body.amountCents).toBe(161000)
    expect(inv.body.lines.at(-1)).toMatchObject({ amountCents: -100000 })
  })

  it('reminder: awaiting approval longer than the window -> in-app note for the office and a calendar item, once a week', async () => {
    const created = await request(server)
      .post('/api/v1/jobs')
      .set(bearer(A.ownerToken))
      .send({
        elevatorId,
        title: 'Шахтни врати',
        lines: [{ kind: 'part', description: 'Врата', qty: 4, unitCents: 58000 }],
      })
    const id = created.body.id
    await request(server)
      .post(`/api/v1/jobs/${id}/send-quote`)
      .set(bearer(A.ownerToken))
      .send({ channel: 'none' })
      .expect(200)
    const before = await runJob('jobs.approvalReminders', {})
    expect((before as Record<string, { reminded: number }>)[A.tenantId]?.reminded).toBe(0)
    await prismaBase.job.update({
      where: { id },
      data: { quoteSentAt: new Date(Date.now() - 20 * 86_400_000) },
    })
    const cal = await request(server)
      .get('/api/v1/calendar?kinds=job_approval&includeOverdue=true')
      .set(bearer(A.ownerToken))
    expect(cal.status, cal.text).toBe(200)
    const item = cal.body.items.find((i: { refId: string }) => i.refId === id)
    expect(item).toMatchObject({ kind: 'job_approval', refType: 'job', severity: 'overdue' })
    expect(item.title).toContain('Шахтни врати')
    const run = await runJob('jobs.approvalReminders', {})
    expect((run as Record<string, { reminded: number }>)[A.tenantId]?.reminded).toBe(1)
    const notes = await prismaBase.notification.findMany({
      where: { tenantId: A.tenantId, relatedType: 'job', relatedId: id, channel: 'in_app' },
    })
    expect(notes.length).toBeGreaterThanOrEqual(2) // owner + office user
    expect(notes[0]?.subject).toContain('20 дни')
    expect(notes[0]?.link).toBe(`/jobs/${id}`)
    const again = await runJob('jobs.approvalReminders', {})
    expect((again as Record<string, { reminded: number }>)[A.tenantId]?.reminded).toBe(0)
    const summary = await request(server).get('/api/v1/jobs/summary').set(bearer(A.ownerToken))
    expect(summary.body.awaitingApproval.overdue).toBe(1)
    const list = await request(server)
      .get('/api/v1/jobs?status=awaiting_approval,draft')
      .set(bearer(A.ownerToken))
    expect(list.body.items.map((j: { id: string }) => j.id)).toEqual(
      expect.arrayContaining([id, job2]),
    )
    const perElevator = await request(server)
      .get(`/api/v1/elevators/${elevatorId}/jobs`)
      .set(bearer(A.ownerToken))
    expect(perElevator.body.items.length).toBeGreaterThanOrEqual(4)
  })
})

describe('jobs: isolation and roles', () => {
  it('every job endpoint answers 404 for a foreign tenant; technicians see only their jobs', async () => {
    const other = await request(server)
      .post('/api/v1/jobs')
      .set(bearer(A.ownerToken))
      .send({ elevatorId, title: 'Чужд', lines: [{ description: 'x', qty: 1, unitCents: 100 }] })
    const id = other.body.id
    const b = bearer(B.ownerToken)
    await request(server).get(`/api/v1/jobs/${id}`).set(b).expect(404)
    await request(server).patch(`/api/v1/jobs/${id}`).set(b).send({ title: 'x' }).expect(404)
    await request(server)
      .post(`/api/v1/jobs/${id}/lines`)
      .set(b)
      .send({ description: 'x', qty: 1, unitCents: 1 })
      .expect(404)
    await request(server).post(`/api/v1/jobs/${id}/quote`).set(b).expect(404)
    await request(server).post(`/api/v1/jobs/${id}/send-quote`).set(b).send({}).expect(404)
    await request(server).post(`/api/v1/jobs/${id}/revise`).set(b).send({}).expect(404)
    await request(server)
      .post(`/api/v1/jobs/${id}/transition`)
      .set(b)
      .send({ to: 'quoted' })
      .expect(404)
    await request(server)
      .post(`/api/v1/jobs/${id}/schedule`)
      .set(b)
      .send({ scheduledAt: '2026-09-15T09:00:00+03:00', assignedUserIds: [techId] })
      .expect(404)
    await request(server).post(`/api/v1/jobs/${id}/start`).set(b).send({}).expect(404)
    await request(server).post(`/api/v1/jobs/${id}/note`).set(b).send({ notes: 'x' }).expect(404)
    await request(server).post(`/api/v1/jobs/${id}/complete`).set(b).send({}).expect(404)
    await request(server).post(`/api/v1/jobs/${id}/invoice`).set(b).send({}).expect(404)
    await request(server).post(`/api/v1/jobs/${id}/reject`).set(b).send({ reason: 'x' }).expect(404)
    await request(server).post(`/api/v1/jobs/${id}/cancel`).set(b).send({ reason: 'x' }).expect(404)
    await request(server).get(`/api/v1/elevators/${elevatorId}/jobs`).set(b).expect(404)
    await request(server).post('/api/v1/jobs').set(b).send({ elevatorId, title: 'x' }).expect(404)
    const bList = await request(server).get('/api/v1/jobs').set(b)
    expect(bList.body.items).toEqual([])
    const byOrigin = await request(server)
      .get(`/api/v1/jobs/by-origin?originType=defect&ids=${defectId}`)
      .set(b)
    expect(byOrigin.body.items).toEqual({})
    // The technician is not assigned to this one.
    await request(server).get(`/api/v1/jobs/${id}`).set(techHeaders()).expect(404)
    await request(server).post(`/api/v1/jobs/${id}/start`).set(techHeaders()).send({}).expect(404)
    await request(server).get('/api/v1/geo/search?q=x').set(techHeaders()).expect(403)
    await request(server).post(`/api/v1/jobs/${id}/invoice`).set(techHeaders()).send({}).expect(403)
    await request(server)
      .put('/api/v1/jobs/stages')
      .set(techHeaders())
      .send({ stages: [] })
      .expect(403)
  })
})

describe('address search and "add an elevator here"', () => {
  it('GET /geo/search returns parsed suggestions (stub adapter)', async () => {
    const res = await request(server)
      .get('/api/v1/geo/search?q=' + encodeURIComponent('ж.к. Младост 1, бл. 25'))
      .set(bearer(officeToken))
    expect(res.status, res.text).toBe(200)
    expect(res.body.items).toHaveLength(3)
    expect(res.body.items[0]).toMatchObject({
      provider: 'stub',
      approximate: true,
      address: { city: 'София', district: 'ж.к. Младост 1', block: '25' },
    })
    expect(res.body.items[0].label).toContain('бл. 25')
    const none = await request(server)
      .get('/api/v1/geo/search?q=' + encodeURIComponent('никъде'))
      .set(bearer(officeToken))
    expect(none.body.items).toEqual([])
    await request(server).get('/api/v1/geo/search?q=a').set(bearer(officeToken)).expect(400)
  })

  it('GET /buildings/nearby lists buildings within the radius with the distance', async () => {
    const res = await request(server)
      .get(`/api/v1/buildings/nearby?lat=${LAT + 0.0002}&lng=${LNG}&radiusM=60`)
      .set(bearer(A.ownerToken))
    expect(res.status, res.text).toBe(200)
    expect(res.body.items).toHaveLength(1)
    expect(res.body.items[0]).toMatchObject({
      id: buildingId,
      customerName: 'ЕС „Младост 25“',
      elevatorCount: 1,
    })
    expect(res.body.items[0].distanceM).toBeGreaterThan(15)
    expect(res.body.items[0].distanceM).toBeLessThan(30)
    const far = await request(server)
      .get(`/api/v1/buildings/nearby?lat=${LAT + 0.01}&lng=${LNG}`)
      .set(bearer(A.ownerToken))
    expect(far.body.items).toEqual([])
    const other = await request(server)
      .get(`/api/v1/buildings/nearby?lat=${LAT}&lng=${LNG}`)
      .set(bearer(B.ownerToken))
    expect(other.body.items).toEqual([])
  })

  it('POST /buildings/with-elevator creates building (manual geocode), customer and elevator in one call', async () => {
    const res = await request(server)
      .post('/api/v1/buildings/with-elevator')
      .set(bearer(officeToken))
      .send({
        building: {
          address: { city: 'София', district: 'ж.к. Младост 1', block: '26', entrance: 'Б' },
          lat: 42.6512,
          lng: 23.3785,
        },
        newCustomer: { name: 'ЕС „Младост 26“', kind: 'etazhna_sobstvenost' },
        elevator: { internalNo: 'вх. Б', stops: 8, driveType: 'electric', doorType: 'manual' },
      })
    expect(res.status, res.text).toBe(201)
    expect(res.body.created).toEqual({ building: true, customer: true })
    expect(res.body.building).toMatchObject({
      geocodeStatus: 'manual',
      lat: 42.6512,
      lng: 23.3785,
      customerName: 'ЕС „Младост 26“',
    })
    expect(res.body.building.addressText).toContain('бл. 26')
    expect(res.body.elevator).toMatchObject({
      internalNo: 'вх. Б',
      stops: 8,
      buildingId: res.body.building.id,
    })
    const pins = await request(server).get('/api/v1/buildings/pins').set(bearer(A.ownerToken))
    expect(pins.body.items.some((p: { id: string }) => p.id === res.body.building.id)).toBe(true)
    const dash = await request(server).get('/api/v1/dashboard').set(bearer(A.ownerToken))
    expect(
      dash.body.pins.some((p: { elevatorId: string }) => p.elevatorId === res.body.elevator.id),
    ).toBe(true)
    // Attach to the existing building instead of creating a duplicate.
    const attach = await request(server)
      .post('/api/v1/buildings/with-elevator')
      .set(bearer(officeToken))
      .send({
        buildingId: res.body.building.id,
        elevator: { internalNo: 'вх. Б десен', stops: 8 },
      })
    expect(attach.status, attach.text).toBe(201)
    expect(attach.body.created).toEqual({ building: false, customer: false })
    expect(attach.body.building.id).toBe(res.body.building.id)
    expect(attach.body.building.elevatorCount).toBe(2)
    await request(server)
      .post('/api/v1/buildings/with-elevator')
      .set(bearer(B.ownerToken))
      .send({ buildingId: res.body.building.id, elevator: { internalNo: 'x', stops: 5 } })
      .expect(404)
    await request(server)
      .post('/api/v1/buildings/with-elevator')
      .set(bearer(officeToken))
      .send({ elevator: { internalNo: 'x', stops: 5 } })
      .expect(400)
    expect(bElevatorId).toBeTruthy()
  })
})
