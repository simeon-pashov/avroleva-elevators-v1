import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { randomUUID } from 'node:crypto'
import { disconnectDb, prismaBase } from '../../src/platform/db/prisma.js'
import { addDays, clock, todayInSofia } from '../../src/platform/clock.js'
import { adapters } from '../../src/platform/adapters/index.js'
import { sentEmails } from '../../src/platform/adapters/notifications/console.js'
import { events, eventDelivery } from '../../src/platform/events/bus.js'
import { runJob } from '../../src/platform/jobs/registry.js'
import { newId } from '../../src/platform/ids.js'
import { registerSubscribers } from '../../src/subscribers.js'
import { ensureJobsRegistered } from '../../src/worker.js'
import { checklists } from '../../src/modules/maintenance/index.js'
import * as notifications from '../../src/modules/notifications/index.js'
import {
  CSRF,
  adminToken,
  app,
  bearer,
  createCustomer,
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
let contactId: string
let phoneOnlyBuildingId: string
let phoneOnlyElevatorId: string
let bElevatorId: string
const today = todayInSofia()

/** Tiny RFC 4180 line parser for the assertions (quoted cells may contain commas). */
function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') quoted = false
      else cur += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
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
  registerSubscribers()
  ensureJobsRegistered()
  server = app()
  A = await createTenant(server, 'Alpha')
  B = await createTenant(server, 'Beta')
  customerId = (await createCustomer(server, A.ownerToken, 'ЕС Алфа')).id
  const b = await request(server)
    .post('/api/v1/buildings')
    .set(bearer(A.ownerToken))
    .send({
      customerId,
      address: { city: 'София', district: 'ж.к. Дружба 1', block: '45', entrance: 'Б' },
    })
  buildingId = b.body.id
  const c = await request(server).post('/api/v1/contacts').set(bearer(A.ownerToken)).send({
    buildingId,
    name: 'Петя Димова',
    phone: '0888 123 456',
    email: 'petya@example.com',
    hasViber: true,
    isPrimary: true,
  })
  contactId = c.body.id
  const e = await request(server)
    .post('/api/v1/elevators')
    .set(bearer(A.ownerToken))
    .send({
      buildingId,
      internalNo: 'вх. Б, ляв',
      stops: 8,
      regNo: 'СФ-5001',
      lastCheckAt: addDays(today, -31),
      checkIntervalDays: 30,
    })
  elevatorId = e.body.id
  const b2 = await request(server)
    .post('/api/v1/buildings')
    .set(bearer(A.ownerToken))
    .send({
      customerId,
      address: { city: 'София', district: 'ж.к. Люлин 5', block: '512', entrance: 'В' },
    })
  phoneOnlyBuildingId = b2.body.id
  await request(server).post('/api/v1/contacts').set(bearer(A.ownerToken)).send({
    buildingId: phoneOnlyBuildingId,
    name: 'Стефка Николова',
    phone: '0898 444 555',
    hasViber: true,
    isPrimary: true,
  })
  const e2 = await request(server).post('/api/v1/elevators').set(bearer(A.ownerToken)).send({
    buildingId: phoneOnlyBuildingId,
    internalNo: 'вх. В',
    stops: 6,
    lastCheckAt: today,
    checkIntervalDays: 30,
  })
  phoneOnlyElevatorId = e2.body.id
  // Tenant B: one building + elevator, used to prove scoping and that the purge leaves it alone.
  const cB = await createCustomer(server, B.ownerToken, 'ЕС Бета')
  const bB = await request(server)
    .post('/api/v1/buildings')
    .set(bearer(B.ownerToken))
    .send({ customerId: cB.id, address: { city: 'Пловдив', street: 'ул. Бета', number: '2' } })
  const eB = await request(server)
    .post('/api/v1/elevators')
    .set(bearer(B.ownerToken))
    .send({
      buildingId: bB.body.id,
      internalNo: 'Б-1',
      stops: 5,
      lastCheckAt: addDays(today, -40),
      checkIntervalDays: 30,
    })
  bElevatorId = eB.body.id
  expect(bElevatorId).toBeTruthy()
})

afterAll(async () => {
  clock.now = () => new Date()
  await disconnectDb()
})

describe('notification rules and templates', () => {
  it('lists the default rule set (seeded on first read) and toggles a rule', async () => {
    const res = await request(server).get('/api/v1/notifications/rules').set(bearer(A.ownerToken))
    expect(res.status, res.text).toBe(200)
    expect(res.body.items.length).toBe(18)
    const visitEmail = res.body.items.find(
      (r: { eventType: string; channel: string; recipientKind: string }) =>
        r.eventType === 'VisitRecorded' &&
        r.channel === 'email' &&
        r.recipientKind === 'building_contact',
    )
    expect(visitEmail.enabled).toBe(true)
    expect(visitEmail.config.fallbackViberLink).toBe(true)
    const off = await request(server)
      .put('/api/v1/notifications/rules/CheckOverdue/in_app/office')
      .set(bearer(A.ownerToken))
      .send({ enabled: false })
    expect(off.status, off.text).toBe(200)
    expect(off.body.enabled).toBe(false)
    const again = await request(server).get('/api/v1/notifications/rules').set(bearer(A.ownerToken))
    expect(
      again.body.items.find((r: { eventType: string }) => r.eventType === 'CheckOverdue').enabled,
    ).toBe(false)
    // Tenant B is unaffected and gets its own defaults.
    const bRules = await request(server)
      .get('/api/v1/notifications/rules')
      .set(bearer(B.ownerToken))
    expect(
      bRules.body.items.find((r: { eventType: string }) => r.eventType === 'CheckOverdue').enabled,
    ).toBe(true)
  })

  it('previews a template with sample data in both locales and rejects a broken draft', async () => {
    const bg = await request(server)
      .post('/api/v1/notifications/templates/preview')
      .set(bearer(A.ownerToken))
      .send({ key: 'visit_recorded', channel: 'email' })
    expect(bg.status, bg.text).toBe(200)
    expect(bg.body.subject).toContain('посещение')
    expect(bg.body.body).toContain('Здравейте')
    const en = await request(server)
      .post('/api/v1/notifications/templates/preview')
      .set(bearer(A.ownerToken))
      .send({ key: 'visit_recorded', channel: 'email', locale: 'en' })
    expect(en.body.subject).toContain('visit')
    const bad = await request(server)
      .post('/api/v1/notifications/templates/preview')
      .set(bearer(A.ownerToken))
      .send({ key: 'visit_recorded', channel: 'email', body: '{{#if x}}' })
    expect(bad.status).toBe(400)
    expect(bad.body.code).toBe('notifications.templateInvalid')
  })

  it('a tenant override shadows the system template and can be reset', async () => {
    const put = await request(server)
      .put('/api/v1/notifications/templates/visit_recorded/in_app/bg')
      .set(bearer(A.ownerToken))
      .send({ subject: 'Наше заглавие {{elevator.internalNo}}', body: 'Наш текст' })
    expect(put.status, put.text).toBe(200)
    const prev = await request(server)
      .post('/api/v1/notifications/templates/preview')
      .set(bearer(A.ownerToken))
      .send({ key: 'visit_recorded', channel: 'in_app', locale: 'bg' })
    expect(prev.body.subject).toContain('Наше заглавие')
    const del = await request(server)
      .delete('/api/v1/notifications/templates/visit_recorded/in_app/bg')
      .set(bearer(A.ownerToken))
    expect(del.status).toBe(204)
    const back = await request(server)
      .post('/api/v1/notifications/templates/preview')
      .set(bearer(A.ownerToken))
      .send({ key: 'visit_recorded', channel: 'in_app', locale: 'bg' })
    expect(back.body.subject).toContain('Посещение')
  })

  it('test-send writes an in-app row for the current user and an e-mail through the console adapter', async () => {
    const before = sentEmails.length
    const inApp = await request(server)
      .post('/api/v1/notifications/test-send')
      .set(bearer(A.ownerToken))
      .send({ key: 'test_message', channel: 'in_app' })
    expect(inApp.status, inApp.text).toBe(201)
    expect(inApp.body.status).toBe('sent')
    const mail = await request(server)
      .post('/api/v1/notifications/test-send')
      .set(bearer(A.ownerToken))
      .send({ key: 'test_message', channel: 'email', to: 'owner@example.com' })
    expect(mail.status, mail.text).toBe(201)
    await waitFor(() => Promise.resolve(sentEmails.length > before))
    expect(sentEmails[sentEmails.length - 1]!.to).toBe('owner@example.com')
    const row = await waitFor(() =>
      prismaBase.notification.findFirst({ where: { id: mail.body.id, status: 'sent' } }),
    )
    expect(row.providerId).toContain('console')
  })
})

describe('events -> notifications (subscriber via the outbox)', () => {
  it('a recorded visit e-mails the building contact and nothing reaches tenant B', async () => {
    const before = sentEmails.length
    const v = await request(server)
      .post('/api/v1/visits')
      .set(bearer(A.ownerToken))
      .send({
        elevatorId,
        kind: 'functional_check',
        startedAt: new Date().toISOString(),
        technicians: [{ name: 'Иван Петров' }, { name: 'Георги Илиев' }],
        notes: 'Всичко наред.',
      })
    expect(v.status, v.text).toBe(201)
    const row = await waitFor(() =>
      prismaBase.notification.findFirst({
        where: {
          tenantId: A.tenantId,
          channel: 'email',
          relatedType: 'visit',
          relatedId: v.body.id,
          status: 'sent',
        },
      }),
    )
    expect(row.to).toBe('petya@example.com')
    expect(row.subject).toContain('вх. Б, ляв')
    expect(row.body).toContain('Петя Димова')
    expect(row.eventType).toBe('VisitRecorded')
    expect(sentEmails.length).toBeGreaterThan(before)
    expect(await prismaBase.notification.count({ where: { tenantId: B.tenantId } })).toBe(0)
    // Delivery bookkeeping: exactly one done row for the notifications handler of this event.
    const ev = await prismaBase.domainEvent.findFirst({
      where: { type: 'VisitRecorded', aggregateId: v.body.id },
    })
    const deliveries = await prismaBase.eventDelivery.findMany({ where: { eventId: ev!.id } })
    expect(deliveries.map((d) => [d.handler, d.status])).toEqual([['notifications.rules', 'done']])
  })

  it('without an e-mail the building gets a Viber link suggestion the office marks as sent', async () => {
    const v = await request(server)
      .post('/api/v1/visits')
      .set(bearer(A.ownerToken))
      .send({
        elevatorId: phoneOnlyElevatorId,
        kind: 'functional_check',
        startedAt: new Date().toISOString(),
        technicians: [{ name: 'Иван Петров' }],
      })
    expect(v.status, v.text).toBe(201)
    const row = await waitFor(() =>
      prismaBase.notification.findFirst({
        where: { tenantId: A.tenantId, channel: 'viber_link', relatedId: v.body.id },
      }),
    )
    expect(row.status).toBe('queued')
    const log = await request(server)
      .get(`/api/v1/notifications?relatedType=visit&relatedId=${v.body.id}`)
      .set(bearer(A.ownerToken))
    expect(log.status).toBe(200)
    const dto = log.body.items.find((n: { id: string }) => n.id === row.id)
    expect(dto.viber.number).toBe('+359898444555')
    expect(dto.viber.forwardUrl).toContain('viber://forward?text=')
    expect(dto.viber.text).toContain('вх. В')
    const mark = await request(server)
      .post(`/api/v1/notifications/${row.id}/mark-sent`)
      .set(bearer(A.ownerToken))
    expect(mark.status, mark.text).toBe(200)
    expect(mark.body.status).toBe('sent')
    const foreign = await request(server)
      .post(`/api/v1/notifications/${row.id}/mark-sent`)
      .set(bearer(B.ownerToken))
    expect(foreign.status).toBe(404)
  })

  it('an opened callback lands in the owner inbox (bell), read state is per user', async () => {
    const cb = await request(server).post('/api/v1/callbacks').set(bearer(A.ownerToken)).send({
      elevatorId,
      classification: 'trapped_persons',
      trappedCount: 1,
      description: 'Кабината спря между 3 и 4 етаж',
    })
    expect(cb.status, cb.text).toBe(201)
    await waitFor(() =>
      prismaBase.notification.findFirst({
        where: { tenantId: A.tenantId, channel: 'in_app', relatedId: cb.body.id },
      }),
    )
    const inbox = await request(server).get('/api/v1/notifications/inbox').set(bearer(A.ownerToken))
    expect(inbox.status).toBe(200)
    expect(inbox.body.unread).toBeGreaterThanOrEqual(1)
    const item = inbox.body.items.find((n: { relatedId: string }) => n.relatedId === cb.body.id)
    expect(item.subject).toContain('Нова авария')
    expect(item.link).toBe('/callbacks')
    // Only one rule (owner in_app) matched for this single owner user: no duplicate rows.
    const rows = await prismaBase.notification.count({
      where: { tenantId: A.tenantId, channel: 'in_app', relatedId: cb.body.id },
    })
    expect(rows).toBe(1)
    const read = await request(server)
      .post('/api/v1/notifications/inbox/read')
      .set(bearer(A.ownerToken))
      .send({ ids: [item.id] })
    expect(read.body.marked).toBe(1)
    const after = await request(server).get('/api/v1/notifications/inbox').set(bearer(A.ownerToken))
    expect(after.body.items.find((n: { id: string }) => n.id === item.id).readAt).not.toBeNull()
  })

  it('the viber-link builder endpoint needs no row', async () => {
    const res = await request(server)
      .post('/api/v1/notifications/viber-link')
      .set(bearer(A.ownerToken))
      .send({ phone: '0888 123 456', text: 'Здравейте' })
    expect(res.status).toBe(200)
    expect(res.body.webUrl).toBe('https://viber.click/359888123456')
  })

  it('delivery is idempotent per (event, handler): a redelivery does not run the handler twice', async () => {
    let runs = 0
    const off = events.subscribe('Step5Probe', async () => void runs++, 'step5.probe')
    try {
      const e = await events.publish(
        { tenantId: A.tenantId },
        { type: 'Step5Probe', aggregateType: 'probe', aggregateId: randomUUID(), payload: {} },
      )
      await waitFor(() => Promise.resolve(runs === 1))
      await eventDelivery.deliver(e.id, 'step5.probe')
      await eventDelivery.deliver(e.id, 'step5.probe')
      expect(runs).toBe(1)
      const d = await prismaBase.eventDelivery.findUnique({
        where: { eventId_handler: { eventId: e.id, handler: 'step5.probe' } },
      })
      expect(d?.status).toBe('done')
      expect(d?.attempts).toBe(1)
    } finally {
      off()
    }
  })

  it('a failing handler records the error and is re-run by a redelivery until it succeeds', async () => {
    let calls = 0
    const off = events.subscribe(
      'Step5Flaky',
      async () => {
        calls++
        if (calls < 2) throw new Error('boom')
      },
      'step5.flaky',
    )
    try {
      const e = await events.publish(
        { tenantId: A.tenantId },
        { type: 'Step5Flaky', aggregateType: 'probe', aggregateId: randomUUID(), payload: {} },
      )
      await waitFor(() => Promise.resolve(calls === 1))
      const failed = await waitFor(() =>
        prismaBase.eventDelivery.findFirst({
          where: { eventId: e.id, handler: 'step5.flaky', lastError: 'boom' },
        }),
      )
      expect(failed.status).toBe('pending')
      await eventDelivery.deliver(e.id, 'step5.flaky')
      expect(calls).toBe(2)
      const done = await prismaBase.eventDelivery.findUnique({
        where: { eventId_handler: { eventId: e.id, handler: 'step5.flaky' } },
      })
      expect(done?.status).toBe('done')
      expect(done?.attempts).toBe(2)
    } finally {
      off()
    }
  })
})

describe('scheduled jobs (direct handler calls, fake clock)', () => {
  it('billing.rollOverdue rolls issued -> overdue once and notifies the office', async () => {
    const contract = await request(server)
      .post('/api/v1/contracts')
      .set(bearer(A.ownerToken))
      .send({
        customerId,
        buildingId,
        startDate: '2026-01-01',
        lines: [{ elevatorId, monthlyPriceCents: 5500 }],
      })
    expect(contract.status, contract.text).toBe(201)
    await prismaBase.invoice.create({
      data: {
        id: newId(),
        tenantId: A.tenantId,
        contractId: contract.body.id,
        buildingId,
        customerId,
        number: 1,
        periodStart: new Date('2026-07-01T00:00:00Z'),
        periodEnd: new Date('2026-07-31T00:00:00Z'),
        issuedAt: new Date('2026-07-01T00:00:00Z'),
        dueAt: new Date('2026-07-15T00:00:00Z'),
        amountCents: 5500,
        vatCents: 1100,
        totalCents: 6600,
        status: 'issued',
      },
    })
    const first = (await runJob('billing.rollOverdue')) as Record<string, number>
    expect(first[A.tenantId]).toBe(1)
    const second = (await runJob('billing.rollOverdue')) as Record<string, number>
    expect(second[A.tenantId]).toBe(0)
    expect(
      await prismaBase.domainEvent.count({
        where: { tenantId: A.tenantId, type: 'InvoiceOverdue' },
      }),
    ).toBe(1)
    const row = await waitFor(() =>
      prismaBase.notification.findFirst({
        where: { tenantId: A.tenantId, eventType: 'InvoiceOverdue', channel: 'in_app' },
      }),
    )
    expect(row.subject).toContain('Просрочена фактура № 1')
    const mail = await waitFor(() =>
      prismaBase.notification.findFirst({
        where: { tenantId: A.tenantId, eventType: 'InvoiceOverdue', channel: 'email' },
      }),
    )
    expect(mail.to).toBe('petya@example.com')
    const run = await prismaBase.jobRun.findUnique({ where: { name: 'billing.rollOverdue' } })
    expect(run?.lastStatus).toBe('ok')
    expect(run?.cron).toBe('10 0 * * *')
  })

  it('callbacks.slaWatch emits at-risk then breached exactly once per callback', async () => {
    const cb = await request(server)
      .post('/api/v1/callbacks')
      .set(bearer(A.ownerToken))
      .send({
        elevatorId,
        description: 'Не тръгва',
        receivedAt: new Date(Date.now() - 50 * 60_000).toISOString(),
      })
    expect(cb.status, cb.text).toBe(201)
    const r1 = (await runJob('callbacks.slaWatch')) as Record<
      string,
      { atRisk: number; breached: number }
    >
    expect(r1[A.tenantId]!.atRisk).toBeGreaterThanOrEqual(1)
    const r2 = (await runJob('callbacks.slaWatch')) as Record<
      string,
      { atRisk: number; breached: number }
    >
    expect(r2[A.tenantId]).toEqual({ atRisk: 0, breached: 0 })
    expect(
      await prismaBase.domainEvent.count({
        where: { type: 'CallbackSlaAtRisk', aggregateId: cb.body.id },
      }),
    ).toBe(1)
    const real = clock.now
    clock.now = () => new Date(real().getTime() + 20 * 60_000)
    try {
      const r3 = (await runJob('callbacks.slaWatch')) as Record<
        string,
        { atRisk: number; breached: number }
      >
      expect(r3[A.tenantId]!.breached).toBeGreaterThanOrEqual(1)
      const r4 = (await runJob('callbacks.slaWatch')) as Record<
        string,
        { atRisk: number; breached: number }
      >
      expect(r4[A.tenantId]!.breached).toBe(0)
    } finally {
      clock.now = real
    }
    const inApp = await waitFor(() =>
      prismaBase.notification.findFirst({
        where: { tenantId: A.tenantId, eventType: 'CallbackSlaBreached', relatedId: cb.body.id },
      }),
    )
    expect(inApp.subject).toContain('Просрочена реакция')
    await request(server)
      .post(`/api/v1/callbacks/${cb.body.id}/close`)
      .set(bearer(A.ownerToken))
      .send({ cause: 'тест', actionTaken: 'тест' })
  })

  it('calendar.materialise emits CheckOverdue on day 1 only (idempotent), respecting the disabled rule', async () => {
    // elevatorId: lastCheckAt = today - 31, interval 30 -> overdue 1 day -> emitted once.
    const r1 = (await runJob('calendar.materialise')) as Record<string, { checkOverdue: number }>
    expect(r1[A.tenantId]!.checkOverdue).toBeGreaterThanOrEqual(0)
    const r2 = (await runJob('calendar.materialise')) as Record<string, { checkOverdue: number }>
    expect(r2[A.tenantId]!.checkOverdue).toBe(0)
    const events1 = await prismaBase.domainEvent.count({
      where: { type: 'CheckOverdue', tenantId: A.tenantId },
    })
    expect(events1).toBeLessThanOrEqual(1)
    // Tenant B's elevator is 10 days overdue (not day 1, not a multiple of 7): nothing emitted.
    expect(
      await prismaBase.domainEvent.count({
        where: { type: 'CheckOverdue', aggregateId: bElevatorId },
      }),
    ).toBe(0)
  })

  it('documents.retentionSweep purges photos of visits older than retentionYears and flags the visit', async () => {
    const set = await request(server)
      .patch('/api/v1/tenant')
      .set(bearer(A.ownerToken))
      .send({ settings: { retentionYears: 1 } })
    expect(set.status, set.text).toBe(200)
    const old = await request(server)
      .post('/api/v1/visits')
      .set(bearer(A.ownerToken))
      .send({
        elevatorId,
        kind: 'technical_maintenance',
        startedAt: '2024-01-10T09:00:00Z',
        technicians: [{ name: 'Стар' }],
      })
    expect(old.status, old.text).toBe(201)
    const attachmentId = newId()
    const key = `attachments/${A.tenantId}/24/01/${attachmentId}.jpg`
    await adapters.storage.put(key, Buffer.from('not-really-a-jpeg'), 'image/jpeg')
    await prismaBase.attachment.create({
      data: {
        id: attachmentId,
        tenantId: A.tenantId,
        sha256: 'x',
        mime: 'image/jpeg',
        bytes: 17,
        storageKey: key,
      },
    })
    await prismaBase.visitAttachment.create({
      data: { id: newId(), tenantId: A.tenantId, visitId: old.body.id, attachmentId },
    })
    const r = (await runJob('documents.retentionSweep')) as Record<
      string,
      { visits: number; attachments: number }
    >
    expect(r[A.tenantId]).toMatchObject({ visits: 1, attachments: 1 })
    expect(r[B.tenantId]).toEqual({ skipped: true })
    const v = await prismaBase.visit.findUnique({ where: { id: old.body.id } })
    expect(v?.photosPurgedAt).not.toBeNull()
    expect(await prismaBase.attachment.findUnique({ where: { id: attachmentId } })).toBeNull()
    expect(await adapters.storage.exists(key)).toBe(false)
    const dto = await request(server).get(`/api/v1/visits/${old.body.id}`).set(bearer(A.ownerToken))
    expect(dto.body.photosPurgedAt).not.toBeNull()
    // Recent visits keep their photos: a second run finds nothing.
    const again = (await runJob('documents.retentionSweep')) as Record<string, { visits: number }>
    expect(again[A.tenantId]).toEqual({ visits: 0 })
  })

  it('health lists the worker jobs with their last run', async () => {
    const res = await request(server).get('/api/v1/health')
    expect(res.status).toBe(200)
    expect(res.body.worker.enabled).toBe(false)
    const names = res.body.worker.jobs.map((j: { name: string }) => j.name)
    for (const n of [
      'maintenance.recompute',
      'billing.rollOverdue',
      'calendar.materialise',
      'callbacks.slaWatch',
      'documents.retentionSweep',
      'tenancy.deletionSweep',
      'attachments.cleanupOrphans',
      'events.dispatch',
      'notifications.deliver',
      'exports.full',
    ])
      expect(names).toContain(n)
    const roll = res.body.worker.jobs.find(
      (j: { name: string }) => j.name === 'billing.rollOverdue',
    )
    expect(roll.lastStatus).toBe('ok')
    expect(roll.lastFinishedAt).not.toBeNull()
  })
})

describe('exports', () => {
  it('streams elevators.csv with a BOM, scoped to the tenant; technicians are refused', async () => {
    const res = await request(server).get('/api/v1/exports/elevators.csv').set(bearer(A.ownerToken))
    expect(res.status, res.text).toBe(200)
    expect(res.headers['content-type']).toContain('text/csv')
    const text = res.text
    expect(text.charCodeAt(0)).toBe(0xfeff)
    const lines = text.slice(1).split('\r\n').filter(Boolean)
    expect(lines[0]!.startsWith('id,internalNo,regNo,buildingAddressText')).toBe(true)
    expect(lines.length).toBe(3)
    expect(text).toContain('СФ-5001')
    expect(text).not.toContain('Б-1')
    const tech = await request(server)
      .post('/api/v1/users')
      .set(bearer(A.ownerToken))
      .send({
        username: `tech5_${Date.now() % 100000}`,
        password: 'password123',
        name: 'Монтьор',
        role: 'technician',
      })
    const login = await request(server)
      .post('/api/v1/auth/login')
      .set(CSRF)
      .send({ username: tech.body.username, password: 'password123' })
    const forbidden = await request(server)
      .get('/api/v1/exports/elevators.csv')
      .set(bearer(login.body.token))
    expect(forbidden.status).toBe(403)
    const unknown = await request(server)
      .get('/api/v1/exports/secrets.csv')
      .set(bearer(A.ownerToken))
    expect(unknown.status).toBe(404)
  })

  it('visits.csv flattens the checklist into one column per item code', async () => {
    const v = await request(server)
      .post('/api/v1/visits')
      .set(bearer(A.ownerToken))
      .send({
        elevatorId,
        kind: 'functional_check',
        startedAt: new Date().toISOString(),
        technicians: [{ name: 'Иван' }],
        checklist: {
          templateKey: 'functional_check',
          templateVersion: 1,
          items: [
            { code: 'A1', result: 'ok' },
            { code: 'A2', result: 'defect', note: 'не свети' },
          ],
        },
      })
    expect(v.status, v.text).toBe(201)
    const res = await request(server).get('/api/v1/exports/visits.csv').set(bearer(A.ownerToken))
    const lines = res.text.slice(1).split('\r\n').filter(Boolean)
    const header = parseCsvLine(lines[0]!)
    expect(header).toContain('A1')
    expect(header).toContain('A2')
    const row = lines.find((l) => l.startsWith(v.body.id))!
    const cells = parseCsvLine(row)
    expect(cells[header.indexOf('A1')]).toBe('ok')
    expect(cells[header.indexOf('A2')]).toBe('defect: не свети')
    expect(cells[header.indexOf('checklistDefect')]).toBe('1')
  })

  it('the full export runs as a job, lands as a zip behind a signed link and notifies the requester', async () => {
    const req = await request(server).post('/api/v1/exports/full').set(bearer(A.ownerToken))
    expect(req.status, req.text).toBe(202)
    expect(req.body.status).toBe('queued')
    const dup = await request(server).post('/api/v1/exports/full').set(bearer(A.ownerToken))
    expect([202, 409]).toContain(dup.status)
    const done = await waitFor(async () => {
      const r = await request(server)
        .get(`/api/v1/exports/${req.body.id}`)
        .set(bearer(A.ownerToken))
      return r.body.status === 'done' ? r.body : null
    })
    expect(done.downloadUrl).toMatch(/^\/files\/export\/[0-9a-f-]{36}\?exp=\d+&sig=[0-9a-f]{64}$/)
    expect(done.summary.elevators).toBe(2)
    expect(done.summary.visits).toBeGreaterThanOrEqual(3)
    expect(done.bytes).toBeGreaterThan(1000)
    const list = await request(server).get('/api/v1/exports').set(bearer(A.ownerToken))
    expect(list.body.items[0].id).toBe(req.body.id)
    const file = await request(server)
      .get(done.downloadUrl)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => cb(null, Buffer.concat(chunks)))
      })
    expect(file.status).toBe(200)
    expect(file.headers['content-type']).toContain('application/zip')
    expect((file.body as Buffer).subarray(0, 2).toString()).toBe('PK')
    const tampered = await request(server).get(
      done.downloadUrl.replace(/sig=[0-9a-f]{4}/, 'sig=0000'),
    )
    expect(tampered.status).toBe(404)
    const bell = await waitFor(() =>
      prismaBase.notification.findFirst({
        where: {
          tenantId: A.tenantId,
          channel: 'in_app',
          relatedType: 'export_job',
          relatedId: req.body.id,
        },
      }),
    )
    expect(bell.subject).toContain('Експортът')
    expect(bell.link).toBe('/settings/data')
    // Tenant B never sees it.
    const foreign = await request(server)
      .get(`/api/v1/exports/${req.body.id}`)
      .set(bearer(B.ownerToken))
    expect(foreign.status).toBe(404)
  })
})

describe('monthly building report', () => {
  const month = today.slice(0, 7)

  it('builds the DTO and the printable page', async () => {
    const dto = await request(server)
      .get(`/api/v1/reports/building/${buildingId}?month=${month}`)
      .set(bearer(A.ownerToken))
    expect(dto.status, dto.text).toBe(200)
    expect(dto.body.building.addressText).toContain('Дружба')
    expect(dto.body.building.contactEmail).toBe('petya@example.com')
    expect(dto.body.totals.visits).toBeGreaterThanOrEqual(2)
    expect(dto.body.totals.callbacks).toBeGreaterThanOrEqual(2)
    const lift = dto.body.elevators.find((e: { id: string }) => e.id === elevatorId)
    expect(lift.visits.length).toBeGreaterThanOrEqual(2)
    expect(lift.visits.some((v: { defectsFound: string[] }) => v.defectsFound.length > 0)).toBe(
      true,
    )
    const page = await request(server)
      .get(`/print/building-report/${buildingId}?month=${month}`)
      .set(bearer(A.ownerToken))
    expect(page.status, page.text).toBe(200)
    expect(page.headers['content-type']).toContain('text/html')
    expect(page.text).toContain('Какво направихме за вашите асансьори')
    expect(page.text).toContain('ж.к. Дружба 1')
    expect(page.text).toContain('вх. Б, ляв')
    const bad = await request(server)
      .get(`/print/building-report/${buildingId}?month=2026-13`)
      .set(bearer(A.ownerToken))
    expect(bad.status).toBe(400)
    const foreign = await request(server)
      .get(`/api/v1/reports/building/${buildingId}?month=${month}`)
      .set(bearer(B.ownerToken))
    expect(foreign.status).toBe(404)
  })

  it('send e-mails the report as an attachment and logs a report_run; no e-mail = skipped run + 400', async () => {
    const before = sentEmails.length
    const sent = await request(server)
      .post(`/api/v1/reports/building/${buildingId}/send`)
      .set(bearer(A.ownerToken))
      .send({ month })
    expect(sent.status, sent.text).toBe(201)
    expect(sent.body.status).toBe('sent')
    expect(sent.body.sentTo).toBe('petya@example.com')
    expect(sent.body.printUrl).toBe(`/print/building-report/${buildingId}?month=${month}`)
    await waitFor(() => Promise.resolve(sentEmails.length > before))
    const mail = sentEmails[sentEmails.length - 1]!
    expect(mail.to).toBe('petya@example.com')
    expect(mail.subject).toContain('какво направихме')
    expect(mail.attachments?.[0]?.filename).toBe(`otchet-${month}.html`)
    expect(String(mail.attachments?.[0]?.content)).toContain('ж.к. Дружба 1')
    const no = await request(server)
      .post(`/api/v1/reports/building/${phoneOnlyBuildingId}/send`)
      .set(bearer(A.ownerToken))
      .send({ month })
    expect(no.status).toBe(400)
    expect(no.body.code).toBe('reports.noEmail')
    const runs = await request(server)
      .get(`/api/v1/reports?period=${month}`)
      .set(bearer(A.ownerToken))
    expect(runs.body.items.map((r: { status: string }) => r.status).sort()).toEqual([
      'sent',
      'skipped',
    ])
  })

  it('bulk generates one run per building and sends where an e-mail exists', async () => {
    const res = await request(server)
      .post('/api/v1/reports/building/bulk')
      .set(bearer(A.ownerToken))
      .send({ month, send: true })
    expect(res.status, res.text).toBe(200)
    expect(res.body).toMatchObject({ buildings: 2, sent: 1, skipped: 1, failed: 0 })
  })
})

describe('dashboard "this month" strip', () => {
  it('counts the visits and callbacks of the current month', async () => {
    const res = await request(server).get('/api/v1/dashboard').set(bearer(A.ownerToken))
    expect(res.status).toBe(200)
    expect(res.body.thisMonth.period).toBe(today.slice(0, 7))
    expect(res.body.thisMonth.visits).toBeGreaterThanOrEqual(3)
    expect(res.body.thisMonth.callbacks).toBeGreaterThanOrEqual(2)
  })
})

describe('delete-my-data (30-day grace) and the purge sweep', () => {
  it('requires the owner password, schedules 30 days out, audits, notifies, and can be cancelled', async () => {
    const wrong = await request(server)
      .post('/api/v1/tenant/delete-request')
      .set(bearer(A.ownerToken))
      .send({ password: 'nope' })
    expect(wrong.status).toBe(403)
    const cancelNothing = await request(server)
      .post('/api/v1/tenant/delete-request/cancel')
      .set(bearer(A.ownerToken))
    expect(cancelNothing.status).toBe(409)
    const req = await request(server)
      .post('/api/v1/tenant/delete-request')
      .set(bearer(A.ownerToken))
      .send({ password: A.owner.password })
    expect(req.status, req.text).toBe(200)
    expect(req.body.status).toBe('deletion_scheduled')
    const days = (Date.parse(req.body.deletionAt) - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(29.9)
    expect(days).toBeLessThanOrEqual(30)
    const again = await request(server)
      .post('/api/v1/tenant/delete-request')
      .set(bearer(A.ownerToken))
      .send({ password: A.owner.password })
    expect(again.status).toBe(409)
    expect(
      await prismaBase.auditLog.count({
        where: { tenantId: A.tenantId, action: 'tenant.deletionRequested' },
      }),
    ).toBe(1)
    const bell = await waitFor(() =>
      prismaBase.notification.findFirst({
        where: { tenantId: A.tenantId, channel: 'in_app', eventType: 'TenantDeletionScheduled' },
      }),
    )
    expect(bell.subject).toContain('изтриване')
    // Still usable meanwhile.
    const me = await request(server).get('/api/v1/tenant').set(bearer(A.ownerToken))
    expect(me.body.status).toBe('deletion_scheduled')
    // The platform admin sees it and can cancel at the owner's request.
    const admin = await adminToken(server)
    const list = await request(server).get('/api/v1/admin/tenants').set(bearer(admin))
    const mine = list.body.items.find((t: { id: string }) => t.id === A.tenantId)
    expect(mine.status).toBe('deletion_scheduled')
    expect(mine.deletionAt).toBe(req.body.deletionAt)
    const adminCancel = await request(server)
      .post(`/api/v1/admin/tenants/${A.tenantId}/cancel-deletion`)
      .set(bearer(admin))
    expect(adminCancel.status, adminCancel.text).toBe(200)
    expect(adminCancel.body.status).toBe('active')
    expect(adminCancel.body.deletionAt).toBeNull()
    expect(
      await prismaBase.auditLog.count({
        where: {
          tenantId: A.tenantId,
          action: 'tenant.deletionCancelled',
          actorType: 'platformAdmin',
        },
      }),
    ).toBe(1)
    // Owner path: request and cancel.
    const req2 = await request(server)
      .post('/api/v1/tenant/delete-request')
      .set(bearer(A.ownerToken))
      .send({ password: A.owner.password })
    expect(req2.status).toBe(200)
    const cancel = await request(server)
      .post('/api/v1/tenant/delete-request/cancel')
      .set(bearer(A.ownerToken))
    expect(cancel.status, cancel.text).toBe(200)
    expect(cancel.body.status).toBe('active')
  })

  it('the daily sweep hard-deletes only the due tenant (rows + files) and leaves the other untouched', async () => {
    const req = await request(server)
      .post('/api/v1/tenant/delete-request')
      .set(bearer(A.ownerToken))
      .send({ password: A.owner.password })
    expect(req.status).toBe(200)
    const before = (await runJob('tenancy.deletionSweep')) as { purged: string[] }
    expect(before.purged).toEqual([])
    const bBefore = {
      buildings: await prismaBase.building.count({ where: { tenantId: B.tenantId } }),
      elevators: await prismaBase.elevator.count({ where: { tenantId: B.tenantId } }),
      users: await prismaBase.user.count({ where: { tenantId: B.tenantId } }),
      events: await prismaBase.domainEvent.count({ where: { tenantId: B.tenantId } }),
      audit: await prismaBase.auditLog.count({ where: { tenantId: B.tenantId } }),
    }
    const exportKey = (await prismaBase.exportJob.findFirst({
      where: { tenantId: A.tenantId, status: 'done' },
    }))!.storageKey!
    expect(await adapters.storage.exists(exportKey)).toBe(true)
    // Grace period over.
    await prismaBase.tenant.update({
      where: { id: A.tenantId },
      data: { deletionAt: new Date(Date.now() - 1000) },
    })
    const r = (await runJob('tenancy.deletionSweep')) as { purged: string[] }
    expect(r.purged).toEqual([A.tenantId])
    expect(await prismaBase.tenant.findUnique({ where: { id: A.tenantId } })).toBeNull()
    for (const table of [
      'building',
      'elevator',
      'visit',
      'callback',
      'invoice',
      'notification',
      'notification_rule',
      'export_job',
      'report_run',
      'user',
      'session',
      'audit_log',
      'domain_event',
    ]) {
      const rows = await prismaBase.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*)::bigint AS n FROM "${table}" WHERE "tenantId" = $1::uuid`,
        A.tenantId,
      )
      expect(Number(rows[0]!.n), table).toBe(0)
    }
    expect(await adapters.storage.exists(exportKey)).toBe(false)
    const platformLine = await prismaBase.auditLog.findFirst({
      where: { action: 'tenant.purged', entityId: A.tenantId },
    })
    expect(platformLine?.tenantId).toBeNull()
    expect(platformLine?.actorType).toBe('system')
    const bAfter = {
      buildings: await prismaBase.building.count({ where: { tenantId: B.tenantId } }),
      elevators: await prismaBase.elevator.count({ where: { tenantId: B.tenantId } }),
      users: await prismaBase.user.count({ where: { tenantId: B.tenantId } }),
      events: await prismaBase.domainEvent.count({ where: { tenantId: B.tenantId } }),
      audit: await prismaBase.auditLog.count({ where: { tenantId: B.tenantId } }),
    }
    expect(bAfter).toEqual(bBefore)
    const bStill = await request(server).get('/api/v1/tenant').set(bearer(B.ownerToken))
    expect(bStill.status).toBe(200)
    const gone = await request(server).get('/api/v1/tenant').set(bearer(A.ownerToken))
    expect(gone.status).toBe(401)
    expect(contactId).toBeTruthy()
  })
})
