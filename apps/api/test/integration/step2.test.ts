import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { randomUUID } from 'node:crypto'
import { disconnectDb, prismaBase, transaction } from '../../src/platform/db/prisma.js'
import { addDays, todayInSofia } from '../../src/platform/clock.js'
import { nextInvoiceNumber } from '../../src/modules/billing/repo/billing.js'
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
let techToken: string
let techId: string
const today = todayInSofia()
const tomorrow = addDays(today, 1)
const thisMonth = today.slice(0, 7)

/** A building + customer + elevator whose last check was `intervalDays - dueIn` days ago. */
async function fixture(token: string, dueIn: number, district = 'ж.к. Тест', block = '1') {
  const customer = await createCustomer(server, token, `Клиент ${district} ${block}`)
  const bRes = await request(server)
    .post('/api/v1/buildings')
    .set(bearer(token))
    .send({
      customerId: customer.id,
      address: { city: 'София', district, block, entrance: 'А' },
      lat: 42.69,
      lng: 23.32,
    })
  expect(bRes.status).toBe(201)
  const contact = await request(server).post('/api/v1/contacts').set(bearer(token)).send({
    buildingId: bRes.body.id,
    name: 'Домоуправител Тест',
    phone: '0888 111 222',
    isPrimary: true,
  })
  expect(contact.status).toBe(201)
  const eRes = await request(server)
    .post('/api/v1/elevators')
    .set(bearer(token))
    .send({
      buildingId: bRes.body.id,
      internalNo: `вх. А (${block})`,
      stops: 8,
      checkIntervalDays: 30,
      lastCheckAt: addDays(today, dueIn - 30),
    })
  expect(eRes.status).toBe(201)
  return {
    customerId: customer.id as string,
    buildingId: bRes.body.id as string,
    elevatorId: eRes.body.id as string,
  }
}

beforeAll(async () => {
  await resetDb()
  await seedAdmin()
  server = app()
  A = await createTenant(server, 'Alpha')
  B = await createTenant(server, 'Beta')
  const tech = await request(server)
    .post('/api/v1/users')
    .set(bearer(A.ownerToken))
    .send({
      username: `tech_${Date.now() % 100000}`,
      password: 'password123',
      name: 'Иван Техник',
      role: 'technician',
    })
  expect(tech.status).toBe(201)
  techId = tech.body.id
  const login = await request(server)
    .post('/api/v1/auth/login')
    .set(CSRF)
    .send({ username: tech.body.username, password: 'password123' })
  techToken = login.body.token
})

afterAll(async () => {
  await disconnectDb()
})

describe('maintenance: due board, denormalised nextCheckDue, reschedule', () => {
  it('registers nextCheckDueAt on create and lists the elevator on the due board', async () => {
    const f = await fixture(A.ownerToken, 0, 'ж.к. Дю', '1')
    const e = await request(server)
      .get(`/api/v1/elevators/${f.elevatorId}`)
      .set(bearer(A.ownerToken))
    expect(e.body.nextCheckDue).toBe(today)
    expect(e.body.dueState).toBe('today')
    expect(e.body.contact).toMatchObject({ name: 'Домоуправител Тест', phone: '+359888111222' })
    expect(e.body.customerName).toBe('Клиент ж.к. Дю 1')

    const board = await request(server).get('/api/v1/maintenance/due').set(bearer(A.ownerToken))
    expect(board.status).toBe(200)
    expect(board.body.date).toBe(today)
    const group = board.body.due.find((g: { buildingId: string }) => g.buildingId === f.buildingId)
    expect(group).toBeTruthy()
    expect(group.contact.phone).toBe('+359888111222')
    expect(group.elevators.map((x: { elevatorId: string }) => x.elevatorId)).toContain(f.elevatorId)
    expect(board.body.counts.today).toBeGreaterThanOrEqual(1)
  })

  it('overdue elevators are always returned, flagged with daysOverdue', async () => {
    const f = await fixture(A.ownerToken, -3, 'ж.к. Дю', '2')
    const board = await request(server)
      .get('/api/v1/maintenance/due')
      .query({ date: tomorrow })
      .set(bearer(A.ownerToken))
    const row = board.body.overdue
      .flatMap(
        (g: { elevators: Array<{ elevatorId: string; daysOverdue: number; state: string }> }) =>
          g.elevators,
      )
      .find((x: { elevatorId: string }) => x.elevatorId === f.elevatorId)
    expect(row).toMatchObject({ daysOverdue: 4, state: 'overdue' })
    expect(board.body.counts.overdue).toBeGreaterThanOrEqual(1)
  })

  it('reschedule sets a visible override for tomorrow without touching lastCheckAt; past dates are refused', async () => {
    const f = await fixture(A.ownerToken, 0, 'ж.к. Дю', '3')
    const before = await request(server)
      .get(`/api/v1/elevators/${f.elevatorId}`)
      .set(bearer(A.ownerToken))
    const r = await request(server)
      .post(`/api/v1/elevators/${f.elevatorId}/reschedule`)
      .set(bearer(A.ownerToken))
      .send({ toDate: tomorrow })
    expect(r.status).toBe(200)
    expect(r.body.nextCheckOverrideAt).toBe(tomorrow)
    expect(r.body.nextCheckDue).toBe(tomorrow)
    expect(r.body.lastCheckAt).toBe(before.body.lastCheckAt)

    const todayBoard = await request(server)
      .get('/api/v1/maintenance/due')
      .set(bearer(A.ownerToken))
    expect(
      todayBoard.body.due.flatMap((g: { elevators: Array<{ elevatorId: string }> }) => g.elevators),
    ).not.toContainEqual(expect.objectContaining({ elevatorId: f.elevatorId }))
    const tomorrowBoard = await request(server)
      .get('/api/v1/maintenance/due')
      .query({ date: tomorrow })
      .set(bearer(A.ownerToken))
    const row = tomorrowBoard.body.due
      .flatMap(
        (g: { elevators: Array<{ elevatorId: string; nextCheckOverrideAt: string }> }) =>
          g.elevators,
      )
      .find((x: { elevatorId: string }) => x.elevatorId === f.elevatorId)
    expect(row.nextCheckOverrideAt).toBe(tomorrow)

    const past = await request(server)
      .post(`/api/v1/elevators/${f.elevatorId}/reschedule`)
      .set(bearer(A.ownerToken))
      .send({ toDate: addDays(today, -1) })
    expect(past.status).toBe(400)
    expect(past.body.code).toBe('maintenance.rescheduleInPast')

    const cleared = await request(server)
      .post(`/api/v1/elevators/${f.elevatorId}/reschedule`)
      .set(bearer(A.ownerToken))
      .send({ toDate: null })
    expect(cleared.body.nextCheckOverrideAt).toBeNull()
    expect(cleared.body.nextCheckDue).toBe(today)
    await request(server)
      .post(`/api/v1/elevators/${f.elevatorId}/reschedule`)
      .set(bearer(techToken))
      .send({ toDate: tomorrow })
      .expect(403)
  })

  it('changing the tenant cycle strategy recomputes the stored due dates (event subscriber)', async () => {
    const { registerSubscribers } = await import('../../src/subscribers.js')
    registerSubscribers()
    const f = await fixture(A.ownerToken, 5, 'ж.к. Дю', '4')
    await request(server)
      .patch('/api/v1/tenant')
      .set(bearer(A.ownerToken))
      .send({ settings: { cycleStrategy: 'calendar_month' } })
      .expect(200)
    await new Promise((r) => setTimeout(r, 300))
    const e = await request(server)
      .get(`/api/v1/elevators/${f.elevatorId}`)
      .set(bearer(A.ownerToken))
    const last = addDays(today, 5 - 30)
    const [y, m] = last.split('-').map(Number) as [number, number]
    const end = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10)
    expect(e.body.nextCheckDue).toBe(end)
    await request(server)
      .patch('/api/v1/tenant')
      .set(bearer(A.ownerToken))
      .send({ settings: { cycleStrategy: 'rolling' } })
      .expect(200)
    await new Promise((r) => setTimeout(r, 300))
    const back = await request(server)
      .get(`/api/v1/elevators/${f.elevatorId}`)
      .set(bearer(A.ownerToken))
    expect(back.body.nextCheckDue).toBe(addDays(today, 5))
  })
})

describe('visits: record (idempotent), lastCheckAt, history, amend', () => {
  it('recording a check visit moves lastCheckAt, clears the override and removes the row from the board', async () => {
    const f = await fixture(A.ownerToken, 0, 'ж.к. Визити', '1')
    await request(server)
      .post(`/api/v1/elevators/${f.elevatorId}/reschedule`)
      .set(bearer(A.ownerToken))
      .send({ toDate: tomorrow })
      .expect(200)
    const id = randomUUID()
    const body = {
      id,
      elevatorId: f.elevatorId,
      kind: 'functional_check',
      startedAt: new Date().toISOString(),
      technicians: [{ userId: techId }, { name: 'Петър Иванов' }],
      notes: 'Всичко наред.',
      source: 'office',
    }
    const v = await request(server).post('/api/v1/visits').set(bearer(A.ownerToken)).send(body)
    expect(v.status).toBe(201)
    expect(v.body.id).toBe(id)
    expect(v.body.technicians).toEqual([
      { userId: techId, name: 'Иван Техник' },
      { userId: null, name: 'Петър Иванов' },
    ])
    expect(v.body.qualityFlags).toEqual([])

    // idempotent replay
    const again = await request(server).post('/api/v1/visits').set(bearer(A.ownerToken)).send(body)
    expect(again.status).toBe(201)
    expect(again.body.id).toBe(id)
    expect(
      await prismaBase.visit.count({ where: { tenantId: A.tenantId, elevatorId: f.elevatorId } }),
    ).toBe(1)

    const e = await request(server)
      .get(`/api/v1/elevators/${f.elevatorId}`)
      .set(bearer(A.ownerToken))
    expect(e.body.lastCheckAt).toBe(today)
    expect(e.body.nextCheckOverrideAt).toBeNull()
    expect(e.body.nextCheckDue).toBe(addDays(today, 30))
    expect(e.body.dueState).toBe('ok')
    const board = await request(server).get('/api/v1/maintenance/due').set(bearer(A.ownerToken))
    expect(
      board.body.due.flatMap((g: { elevators: Array<{ elevatorId: string }> }) => g.elevators),
    ).not.toContainEqual(expect.objectContaining({ elevatorId: f.elevatorId }))
  })

  it('a repair does not count as a check; a backdated check never moves lastCheckAt backwards; single technician is flagged', async () => {
    const f = await fixture(A.ownerToken, 2, 'ж.к. Визити', '2')
    const last = addDays(today, 2 - 30)
    const repair = await request(server)
      .post('/api/v1/visits')
      .set(bearer(A.ownerToken))
      .send({
        elevatorId: f.elevatorId,
        kind: 'repair',
        startedAt: new Date().toISOString(),
        technicians: [{ name: 'Георги' }],
      })
    expect(repair.status).toBe(201)
    expect(repair.body.qualityFlags).toContain('singleTechnician')
    let e = await request(server).get(`/api/v1/elevators/${f.elevatorId}`).set(bearer(A.ownerToken))
    expect(e.body.lastCheckAt).toBe(last)

    const old = await request(server)
      .post('/api/v1/visits')
      .set(bearer(A.ownerToken))
      .send({
        elevatorId: f.elevatorId,
        kind: 'functional_check',
        startedAt: `${addDays(last, -30)}T10:00:00+03:00`,
        technicians: [{ name: 'А' }, { name: 'Б' }],
        source: 'paper',
      })
    expect(old.status).toBe(201)
    e = await request(server).get(`/api/v1/elevators/${f.elevatorId}`).set(bearer(A.ownerToken))
    expect(e.body.lastCheckAt).toBe(last)

    const future = await request(server)
      .post('/api/v1/visits')
      .set(bearer(A.ownerToken))
      .send({
        elevatorId: f.elevatorId,
        kind: 'functional_check',
        startedAt: new Date(Date.now() + 3 * 3600_000).toISOString(),
        technicians: [{ name: 'А' }],
      })
    expect(future.status).toBe(400)
    expect(future.body.code).toBe('visits.inFuture')
    const noTech = await request(server)
      .post('/api/v1/visits')
      .set(bearer(A.ownerToken))
      .send({ elevatorId: f.elevatorId, startedAt: new Date().toISOString(), technicians: [{}] })
    expect(noTech.status).toBe(400)
  })

  it('history is newest first with a keyset cursor; amend supersedes; technicians may record', async () => {
    const f = await fixture(A.ownerToken, 10, 'ж.к. Визити', '3')
    for (let i = 5; i >= 1; i--) {
      await request(server)
        .post('/api/v1/visits')
        .set(bearer(i % 2 ? techToken : A.ownerToken))
        .send({
          elevatorId: f.elevatorId,
          kind: 'functional_check',
          startedAt: `${addDays(today, -i * 7)}T09:00:00+03:00`,
          technicians: [{ userId: techId }, { name: 'Б' }],
          source: 'paper',
        })
        .expect(201)
    }
    const p1 = await request(server)
      .get(`/api/v1/elevators/${f.elevatorId}/visits`)
      .query({ limit: 2 })
      .set(bearer(A.ownerToken))
    expect(p1.body.items).toHaveLength(2)
    expect(p1.body.nextCursor).toBeTruthy()
    expect(p1.body.items[0].startedAt > p1.body.items[1].startedAt).toBe(true)
    const p2 = await request(server)
      .get(`/api/v1/elevators/${f.elevatorId}/visits`)
      .query({ limit: 2, cursor: p1.body.nextCursor })
      .set(bearer(A.ownerToken))
    expect(p2.body.items).toHaveLength(2)
    expect(p2.body.items[0].startedAt < p1.body.items[1].startedAt).toBe(true)
    const p3 = await request(server)
      .get(`/api/v1/elevators/${f.elevatorId}/visits`)
      .query({ limit: 2, cursor: p2.body.nextCursor })
      .set(bearer(A.ownerToken))
    expect(p3.body.items).toHaveLength(1)
    expect(p3.body.nextCursor).toBeNull()

    const target = p1.body.items[0]
    const amended = await request(server)
      .post(`/api/v1/visits/${target.id}/amend`)
      .set(bearer(A.ownerToken))
      .send({ notes: 'коригирано', kind: 'technical_maintenance' })
    expect(amended.status).toBe(201)
    expect(amended.body.supersedesVisitId).toBe(target.id)
    expect(amended.body.notes).toBe('коригирано')
    const orig = await request(server).get(`/api/v1/visits/${target.id}`).set(bearer(A.ownerToken))
    expect(orig.body.supersededAt).toBeTruthy()
    const list = await request(server)
      .get(`/api/v1/elevators/${f.elevatorId}/visits`)
      .set(bearer(A.ownerToken))
    expect(list.body.items).toHaveLength(5)
    expect(list.body.items.map((v: { id: string }) => v.id)).not.toContain(target.id)
    await request(server)
      .post(`/api/v1/visits/${target.id}/amend`)
      .set(bearer(A.ownerToken))
      .send({ notes: 'пак' })
      .expect(409)

    const all = await request(server)
      .get('/api/v1/visits')
      .query({ from: addDays(today, -40), to: today, elevatorId: f.elevatorId })
      .set(bearer(A.ownerToken))
    expect(all.body.items.length).toBe(5)
  })
})

describe('billing: generate (idempotent, gapless), pay, summary, building/elevator views', () => {
  let bld: Awaited<ReturnType<typeof fixture>>
  let e2: string
  let contractId: string

  beforeAll(async () => {
    bld = await fixture(A.ownerToken, 20, 'ж.к. Пари', '1')
    e2 = (await createElevator(server, A.ownerToken, bld.buildingId, 'вх. А, десен')).id
    const c = await request(server)
      .post('/api/v1/contracts')
      .set(bearer(A.ownerToken))
      .send({
        customerId: bld.customerId,
        buildingId: bld.buildingId,
        startDate: '2026-01-01',
        paymentDay: 10,
        lines: [
          { elevatorId: bld.elevatorId, monthlyPriceCents: 5500 },
          { elevatorId: e2, monthlyPriceCents: 4500 },
        ],
      })
    expect(c.status).toBe(201)
    contractId = c.body.id
  })

  it('generates one issued invoice per active contract for the period and skips on repeat', async () => {
    const g1 = await request(server)
      .post('/api/v1/billing/invoices/generate')
      .set(bearer(A.ownerToken))
      .send({ period: '2026-07' })
    expect(g1.status).toBe(201)
    expect(g1.body.created).toBe(1)
    const inv = g1.body.invoices[0]
    expect(inv).toMatchObject({
      contractId,
      buildingId: bld.buildingId,
      period: '2026-07',
      issuedAt: '2026-07-01',
      dueAt: '2026-07-10',
      amountCents: 10000,
      vatCents: 2000,
      totalCents: 12000,
      currency: 'EUR',
      customerName: 'Клиент ж.к. Пари 1',
    })
    expect(inv.lines).toHaveLength(2)
    const g2 = await request(server)
      .post('/api/v1/billing/invoices/generate')
      .set(bearer(A.ownerToken))
      .send({ period: '2026-07' })
    expect(g2.body.created).toBe(0)
    expect(g2.body.skipped).toBe(1)
    expect(await prismaBase.invoice.count({ where: { tenantId: A.tenantId } })).toBe(1)
    await request(server)
      .post('/api/v1/billing/invoices/generate')
      .set(bearer(A.ownerToken))
      .send({ period: '2026-7' })
      .expect(400)
  })

  it('numbers are gapless per tenant even when a transaction rolls back', async () => {
    await expect(
      transaction(async (tx) => {
        await nextInvoiceNumber(A.tenantId, tx)
        throw new Error('simulated failure')
      }),
    ).rejects.toThrow('simulated failure')
    const g = await request(server)
      .post('/api/v1/billing/invoices/generate')
      .set(bearer(A.ownerToken))
      .send({ period: '2026-08' })
    expect(g.body.created).toBe(1)
    const numbers = (
      await prismaBase.invoice.findMany({
        where: { tenantId: A.tenantId },
        orderBy: { number: 'asc' },
      })
    ).map((i) => i.number)
    expect(numbers).toEqual([1, 2])
    // tenant B starts its own sequence at 1
    const cB = await createCustomer(server, B.ownerToken, 'Б клиент')
    const bB = await createBuilding(server, B.ownerToken, 'ж.к. Б', '9')
    const eB = await createElevator(server, B.ownerToken, bB.id)
    await request(server)
      .post('/api/v1/contracts')
      .set(bearer(B.ownerToken))
      .send({
        customerId: cB.id,
        buildingId: bB.id,
        startDate: '2026-01-01',
        lines: [{ elevatorId: eB.id, monthlyPriceCents: 100 }],
      })
      .expect(201)
    const gB = await request(server)
      .post('/api/v1/billing/invoices/generate')
      .set(bearer(B.ownerToken))
      .send({ period: '2026-08' })
    expect(gB.body.invoices[0].number).toBe(1)
    expect(gB.body.invoices[0].dueAt).toBe('2026-08-15') // no paymentDay -> +14 days
  })

  it('rolls issued -> overdue on read, lists pending, pays (partial then full), summary and views', async () => {
    const pending = await request(server)
      .get('/api/v1/billing/invoices')
      .query({ pending: true })
      .set(bearer(A.ownerToken))
    expect(pending.status).toBe(200)
    expect(pending.body.items).toHaveLength(2)
    expect(pending.body.items.every((i: { status: string }) => i.status === 'overdue')).toBe(true)
    expect(pending.body.items[0].daysOverdue).toBeGreaterThan(0)
    expect(pending.body.items[0].openCents).toBe(12000)

    const july = pending.body.items.find((i: { period: string }) => i.period === '2026-07')
    const partial = await request(server)
      .post(`/api/v1/billing/invoices/${july.id}/pay`)
      .set(bearer(A.ownerToken))
      .send({ paidAt: today, method: 'cash', amountCents: 2000 })
    expect(partial.status).toBe(200)
    expect(partial.body.status).toBe('overdue')
    expect(partial.body.paidCents).toBe(2000)
    expect(partial.body.openCents).toBe(10000)
    // Step 7 (ADR 0001): an over-payment settles the invoice and leaves the rest unallocated.
    const full = await request(server)
      .post(`/api/v1/billing/invoices/${july.id}/pay`)
      .set(bearer(A.ownerToken))
      .send({ paidAt: today, method: 'bank', amountCents: 10001 })
    expect(full.status, full.text).toBe(200)
    expect(full.body.paidCents).toBe(12000)
    const unallocated = await prismaBase.payment.findFirst({
      where: { tenantId: A.tenantId, buildingId: july.buildingId, invoiceId: null, amountCents: 1 },
    })
    expect(unallocated).not.toBeNull()
    expect(full.body.status).toBe('paid')
    expect(full.body.paidAt).toBe(today)
    expect(full.body.openCents).toBe(0)
    await request(server)
      .post(`/api/v1/billing/invoices/${july.id}/pay`)
      .set(bearer(A.ownerToken))
      .send({ paidAt: today, method: 'bank' })
      .expect(409)

    const summary = await request(server)
      .get('/api/v1/billing/summary')
      .query({ month: thisMonth })
      .set(bearer(A.ownerToken))
    expect(summary.body).toMatchObject({
      month: thisMonth,
      pendingCents: 12000,
      pendingCount: 1,
      overdueCents: 12000,
      overdueCount: 1,
      paidThisMonthCents: 12001,
      paidThisMonthCount: 3,
    })

    const paidList = await request(server)
      .get('/api/v1/billing/invoices')
      .query({ status: 'paid', month: '2026-07' })
      .set(bearer(A.ownerToken))
    expect(paidList.body.items.map((i: { id: string }) => i.id)).toEqual([july.id])

    const unallocated = await request(server)
      .post('/api/v1/billing/payments')
      .set(bearer(A.ownerToken))
      .send({
        buildingId: bld.buildingId,
        amountCents: 500,
        paidAt: today,
        method: 'cash',
        note: 'аванс',
      })
    expect(unallocated.status).toBe(201)
    expect(unallocated.body.invoiceId).toBeNull()
    const payments = await request(server)
      .get('/api/v1/billing/payments')
      .query({ month: thisMonth, buildingId: bld.buildingId })
      .set(bearer(A.ownerToken))
    expect(payments.body.items).toHaveLength(3)

    const bb = await request(server)
      .get(`/api/v1/buildings/${bld.buildingId}/billing`)
      .set(bearer(A.ownerToken))
    expect(bb.body.invoices).toHaveLength(2)
    expect(bb.body.pendingCents).toBe(12000)
    expect(bb.body.payments).toHaveLength(3)
    const eb = await request(server)
      .get(`/api/v1/elevators/${e2}/billing`)
      .set(bearer(A.ownerToken))
    expect(eb.body.elevatorId).toBe(e2)
    expect(eb.body.invoices[0].elevatorAmountCents).toBe(4500)

    const dash = await request(server).get('/api/v1/dashboard').set(bearer(A.ownerToken))
    expect(dash.status).toBe(200)
    expect(dash.body.money).toMatchObject({
      pendingCents: 12000,
      overdueCents: 12000,
      overdueCount: 1,
    })
    expect(dash.body.counts.elevators).toBeGreaterThan(5)
    const pin = dash.body.pins.find((p: { elevatorId: string }) => p.elevatorId === bld.elevatorId)
    expect(pin).toMatchObject({ buildingId: bld.buildingId, lat: 42.69, lng: 23.32, state: 'ok' })
    expect(
      dash.body.pins.filter((p: { buildingId: string }) => p.buildingId === bld.buildingId),
    ).toHaveLength(2)
  })

  it('technicians never see money', async () => {
    for (const p of [
      '/api/v1/billing/invoices',
      '/api/v1/billing/summary',
      '/api/v1/billing/payments',
      `/api/v1/buildings/${bld.buildingId}/billing`,
      `/api/v1/elevators/${bld.elevatorId}/billing`,
    ]) {
      expect((await request(server).get(p).set(bearer(techToken))).status, p).toBe(403)
    }
    await request(server)
      .post('/api/v1/billing/invoices/generate')
      .set(bearer(techToken))
      .send({ period: '2026-09' })
      .expect(403)
    // but they may read the board and the dashboard
    await request(server).get('/api/v1/maintenance/due').set(bearer(techToken)).expect(200)
    await request(server).get('/api/v1/dashboard').set(bearer(techToken)).expect(200)
  })
})

describe('tenant isolation for step 2 (visits, reschedule, billing, dashboard)', () => {
  it('B gets 404 on A resources and empty lists', async () => {
    const f = await fixture(A.ownerToken, 0, 'ж.к. Изолация2', '1')
    const c = await request(server)
      .post('/api/v1/contracts')
      .set(bearer(A.ownerToken))
      .send({
        customerId: f.customerId,
        buildingId: f.buildingId,
        startDate: '2026-01-01',
        lines: [{ elevatorId: f.elevatorId, monthlyPriceCents: 100 }],
      })
    expect(c.status).toBe(201)
    const g = await request(server)
      .post('/api/v1/billing/invoices/generate')
      .set(bearer(A.ownerToken))
      .send({ period: '2026-09' })
    const invoiceId = g.body.invoices.find(
      (i: { contractId: string }) => i.contractId === c.body.id,
    ).id
    const v = await request(server)
      .post('/api/v1/visits')
      .set(bearer(A.ownerToken))
      .send({
        elevatorId: f.elevatorId,
        startedAt: new Date().toISOString(),
        technicians: [{ name: 'А' }],
      })
    expect(v.status).toBe(201)

    const b = bearer(B.ownerToken)
    expect(
      (await request(server).get(`/api/v1/elevators/${f.elevatorId}/visits`).set(b)).status,
    ).toBe(404)
    expect((await request(server).get(`/api/v1/visits/${v.body.id}`).set(b)).status).toBe(404)
    expect(
      (await request(server).post(`/api/v1/visits/${v.body.id}/amend`).set(b).send({ notes: 'x' }))
        .status,
    ).toBe(404)
    expect(
      (
        await request(server)
          .post('/api/v1/visits')
          .set(b)
          .send({
            elevatorId: f.elevatorId,
            startedAt: new Date().toISOString(),
            technicians: [{ name: 'Б' }],
          })
      ).status,
    ).toBe(404)
    expect(
      (
        await request(server)
          .post(`/api/v1/elevators/${f.elevatorId}/reschedule`)
          .set(b)
          .send({ toDate: tomorrow })
      ).status,
    ).toBe(404)
    expect(
      (await request(server).get(`/api/v1/elevators/${f.elevatorId}/billing`).set(b)).status,
    ).toBe(404)
    expect(
      (await request(server).get(`/api/v1/buildings/${f.buildingId}/billing`).set(b)).status,
    ).toBe(404)
    expect((await request(server).get(`/api/v1/billing/invoices/${invoiceId}`).set(b)).status).toBe(
      404,
    )
    expect(
      (
        await request(server)
          .post(`/api/v1/billing/invoices/${invoiceId}/pay`)
          .set(b)
          .send({ paidAt: today, method: 'cash' })
      ).status,
    ).toBe(404)
    expect(
      (
        await request(server)
          .post('/api/v1/billing/payments')
          .set(b)
          .send({ buildingId: f.buildingId, amountCents: 100, paidAt: today, method: 'cash' })
      ).status,
    ).toBe(404)
    // B's own invoice with A's user as technician -> 404 too
    expect(
      (
        await request(server)
          .post('/api/v1/visits')
          .set(b)
          .send({
            elevatorId: f.elevatorId,
            startedAt: new Date().toISOString(),
            technicians: [{ userId: techId }],
          })
      ).status,
    ).toBe(404)

    const visitsB = await request(server).get('/api/v1/visits').set(b)
    expect(
      visitsB.body.items.every((x: { elevatorId: string }) => x.elevatorId !== f.elevatorId),
    ).toBe(true)
    const invoicesB = await request(server).get('/api/v1/billing/invoices').set(b)
    expect(invoicesB.body.items.every((x: { id: string }) => x.id !== invoiceId)).toBe(true)
    const dueB = await request(server).get('/api/v1/maintenance/due').set(b)
    expect(JSON.stringify(dueB.body)).not.toContain(f.elevatorId)
    const dashB = await request(server).get('/api/v1/dashboard').set(b)
    expect(
      dashB.body.pins.every((p: { elevatorId: string }) => p.elevatorId !== f.elevatorId),
    ).toBe(true)
    // the pending total of B only counts B's invoice
    const sumB = await request(server).get('/api/v1/billing/summary').set(b)
    expect(sumB.body.pendingCents).toBe(120)
  })

  it('non-uuid ids are plain 404s on the new routes', async () => {
    await request(server).get('/api/v1/elevators/nope/visits').set(bearer(A.ownerToken)).expect(404)
    await request(server)
      .get('/api/v1/elevators/nope/billing')
      .set(bearer(A.ownerToken))
      .expect(404)
    await request(server)
      .post('/api/v1/billing/invoices/nope/pay')
      .set(bearer(A.ownerToken))
      .send({ paidAt: today })
      .expect(404)
  })
})
