import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { disconnectDb, prismaBase } from '../../src/platform/db/prisma.js'
import { addDays, todayInSofia } from '../../src/platform/clock.js'
import { resetElevatorLimits } from '../../src/http/public.js'
import {
  CSRF,
  app,
  bearer,
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
let buildingId: string
let elevatorId: string
let elevator2Id: string
const today = todayInSofia()

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()

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
      username: `tech3_${Date.now() % 100000}`,
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
  const customer = await createCustomer(server, A.ownerToken, 'ЕС Алфа')
  const b = await request(server)
    .post('/api/v1/buildings')
    .set(bearer(A.ownerToken))
    .send({
      customerId: customer.id,
      address: { city: 'София', district: 'ж.к. Тест', block: '3', entrance: 'А' },
      lat: 42.69,
      lng: 23.32,
    })
  buildingId = b.body.id
  await request(server)
    .post('/api/v1/contacts')
    .set(bearer(A.ownerToken))
    .send({ buildingId, name: 'Домоуправител', phone: '0888 000 111', isPrimary: true })
  const e = await request(server)
    .post('/api/v1/elevators')
    .set(bearer(A.ownerToken))
    .send({
      buildingId,
      internalNo: 'вх. А, ляв',
      stops: 8,
      regNo: 'СФ-1001',
      lastCheckAt: addDays(today, -45),
      checkIntervalDays: 30,
    })
  elevatorId = e.body.id
  elevator2Id = (await createElevator(server, A.ownerToken, buildingId, 'вх. А, десен')).id
})

afterAll(async () => {
  await disconnectDb()
})

describe('callbacks', () => {
  let callbackId: string

  it('office intake defaults: open, SLA snapshot 60, timer running', async () => {
    const res = await request(server)
      .post('/api/v1/callbacks')
      .set(bearer(A.ownerToken))
      .send({
        elevatorId,
        channel: 'phone',
        classification: 'trapped_persons',
        trappedCount: 2,
        callerName: 'Мария',
        callerPhone: '0888 123 456',
        description: 'Заседнали двама между 3 и 4 етаж',
        receivedAt: minutesAgo(10),
      })
    expect(res.status, res.text).toBe(201)
    callbackId = res.body.id
    expect(res.body.status).toBe('open')
    expect(res.body.slaMinutes).toBe(60)
    expect(res.body.slaState).toBe('ok')
    expect(res.body.elapsedMinutes).toBeGreaterThanOrEqual(10)
    expect(res.body.responseMinutes).toBeNull()
    expect(res.body.elevatorInternalNo).toBe('вх. А, ляв')
    expect(res.body.trappedCount).toBe(2)
  })

  it('rejects a future receivedAt and an unknown elevator', async () => {
    const future = await request(server)
      .post('/api/v1/callbacks')
      .set(bearer(A.ownerToken))
      .send({
        elevatorId,
        description: 'x',
        receivedAt: new Date(Date.now() + 7_200_000).toISOString(),
      })
    expect(future.status).toBe(400)
    expect(future.body.code).toBe('callbacks.receivedInFuture')
    const missing = await request(server)
      .post('/api/v1/callbacks')
      .set(bearer(A.ownerToken))
      .send({ elevatorId: '00000000-0000-7000-8000-000000000000', description: 'x' })
    expect(missing.status).toBe(404)
  })

  it('technician cannot see an unassigned callback nor dispatch', async () => {
    const list = await request(server).get('/api/v1/callbacks?open=true').set(bearer(techToken))
    expect(list.status).toBe(200)
    expect(list.body.items.map((c: { id: string }) => c.id)).not.toContain(callbackId)
    const dispatch = await request(server)
      .post(`/api/v1/callbacks/${callbackId}/dispatch`)
      .set(bearer(techToken))
      .send({ userId: techId })
    expect(dispatch.status).toBe(403)
  })

  it('dispatch -> on_site (by the technician) -> released -> restored -> close records a visit', async () => {
    const d = await request(server)
      .post(`/api/v1/callbacks/${callbackId}/dispatch`)
      .set(bearer(A.ownerToken))
      .send({ userId: techId, at: minutesAgo(5) })
    expect(d.status, d.text).toBe(200)
    expect(d.body.status).toBe('dispatched')
    expect(d.body.assignedUserId).toBe(techId)
    expect(d.body.assignedUserName).toBe('Иван Техник')

    const mine = await request(server).get('/api/v1/callbacks?open=true').set(bearer(techToken))
    expect(mine.body.items.map((c: { id: string }) => c.id)).toContain(callbackId)

    const onSite = await request(server)
      .post(`/api/v1/callbacks/${callbackId}/on-site`)
      .set(bearer(techToken))
      .set('X-Client', 'app')
      .send({ at: minutesAgo(2) })
    expect(onSite.status, onSite.text).toBe(200)
    expect(onSite.body.status).toBe('on_site')
    expect(onSite.body.responseMinutes).toBeGreaterThanOrEqual(7)
    expect(onSite.body.responseMinutes).toBeLessThanOrEqual(9)
    expect(onSite.body.slaState).toBe('ok')

    const bad = await request(server)
      .post(`/api/v1/callbacks/${callbackId}/on-site`)
      .set(bearer(techToken))
      .send({})
    expect(bad.status).toBe(409)
    expect(bad.body.code).toBe('callbacks.invalidTransition')

    const rel = await request(server)
      .post(`/api/v1/callbacks/${callbackId}/released`)
      .set(bearer(techToken))
      .send({ notes: 'Освободени' })
    expect(rel.status).toBe(200)
    const rest = await request(server)
      .post(`/api/v1/callbacks/${callbackId}/restored`)
      .set(bearer(techToken))
      .send({})
    expect(rest.status).toBe(200)
    expect(rest.body.status).toBe('restored')

    const close = await request(server)
      .post(`/api/v1/callbacks/${callbackId}/close`)
      .set(bearer(A.ownerToken))
      .send({
        cause: 'Спиране на тока',
        actionTaken: 'Освободени пътници, рестарт',
        chargeable: true,
        chargeReason: 'out_of_hours',
      })
    expect(close.status, close.text).toBe(200)
    expect(close.body.status).toBe('closed')
    expect(close.body.chargeable).toBe(true)
    expect(close.body.closeoutVisitId).toBeTruthy()

    const visits = await request(server)
      .get(`/api/v1/elevators/${elevatorId}/visits`)
      .set(bearer(A.ownerToken))
    const visit = visits.body.items.find((v: { id: string }) => v.id === close.body.closeoutVisitId)
    expect(visit).toBeTruthy()
    expect(visit.kind).toBe('callback')
    expect(visit.technicians[0].userId).toBe(techId)

    const again = await request(server)
      .post(`/api/v1/callbacks/${callbackId}/close`)
      .set(bearer(A.ownerToken))
      .send({ cause: 'x', actionTaken: 'y' })
    expect(again.status).toBe(409)
    expect(again.body.code).toBe('callbacks.alreadyClosed')
  })

  it('detail carries the timeline with provenance', async () => {
    const res = await request(server)
      .get(`/api/v1/callbacks/${callbackId}`)
      .set(bearer(A.ownerToken))
    expect(res.status).toBe(200)
    const types = res.body.events.map((e: { type: string }) => e.type)
    expect(types).toEqual(['opened', 'dispatched', 'on_site', 'released', 'restored', 'closed'])
    const onSite = res.body.events.find((e: { type: string }) => e.type === 'on_site')
    expect(onSite.source).toBe('app')
    expect(onSite.byUserName).toBe('Иван Техник')
    expect(onSite.receivedAt).toBeTruthy()
  })

  it('a technician opens a callback himself and is auto-assigned', async () => {
    const res = await request(server)
      .post('/api/v1/callbacks')
      .set(bearer(techToken))
      .send({ elevatorId: elevator2Id, description: 'Обадиха се на мобилния', channel: 'phone' })
    expect(res.status).toBe(201)
    expect(res.body.status).toBe('dispatched')
    expect(res.body.assignedUserId).toBe(techId)
    const closed = await request(server)
      .post(`/api/v1/callbacks/${res.body.id}/close`)
      .set(bearer(techToken))
      .send({ cause: 'Стоп бутон', actionTaken: 'Рестарт', createVisit: false })
    expect(closed.status).toBe(200)
    expect(closed.body.closeoutVisitId).toBeNull()
  })

  it('lists: open filter, status filter, per elevator, cursor, idempotent client id', async () => {
    const id = crypto.randomUUID()
    const first = await request(server)
      .post('/api/v1/callbacks')
      .set(bearer(A.ownerToken))
      .send({ id, elevatorId, description: 'Повреда', receivedAt: minutesAgo(100) })
    expect(first.status).toBe(201)
    const dup = await request(server)
      .post('/api/v1/callbacks')
      .set(bearer(A.ownerToken))
      .send({ id, elevatorId, description: 'Повреда' })
    expect(dup.status).toBe(201)
    expect(dup.body.id).toBe(id)
    expect(dup.body.slaState).toBe('breached')

    const open = await request(server).get('/api/v1/callbacks?open=true').set(bearer(A.ownerToken))
    expect(open.body.items.map((c: { id: string }) => c.id)).toEqual([id])
    const closed = await request(server)
      .get('/api/v1/callbacks?status=closed')
      .set(bearer(A.ownerToken))
    expect(closed.body.items).toHaveLength(2)
    const perElevator = await request(server)
      .get(`/api/v1/elevators/${elevatorId}/callbacks?limit=1`)
      .set(bearer(A.ownerToken))
    expect(perElevator.body.items).toHaveLength(1)
    expect(perElevator.body.nextCursor).toBeTruthy()
    const page2 = await request(server)
      .get(
        `/api/v1/elevators/${elevatorId}/callbacks?limit=1&cursor=${encodeURIComponent(perElevator.body.nextCursor)}`,
      )
      .set(bearer(A.ownerToken))
    expect(page2.body.items).toHaveLength(1)
    expect(page2.body.items[0].id).not.toBe(perElevator.body.items[0].id)
    const ranged = await request(server)
      .get(`/api/v1/callbacks?from=${addDays(today, -1)}&to=${today}`)
      .set(bearer(A.ownerToken))
    expect(ranged.body.items.length).toBeGreaterThanOrEqual(3)
  })

  it('tenant isolation: another tenant gets 404 on every callback route', async () => {
    for (const [method, path] of [
      ['get', `/api/v1/callbacks/${callbackId}`],
      ['post', `/api/v1/callbacks/${callbackId}/dispatch`],
      ['post', `/api/v1/callbacks/${callbackId}/on-site`],
      ['post', `/api/v1/callbacks/${callbackId}/close`],
      ['get', `/api/v1/elevators/${elevatorId}/callbacks`],
    ] as const) {
      const agent = request(server)
      const res = await agent[method](path)
        .set(bearer(B.ownerToken))
        .send(
          path.endsWith('dispatch')
            ? { userId: techId }
            : path.endsWith('close')
              ? { cause: 'x', actionTaken: 'y' }
              : {},
        )
      expect(res.status, `${method} ${path}`).toBe(404)
    }
    const list = await request(server).get('/api/v1/callbacks').set(bearer(B.ownerToken))
    expect(list.body.items).toHaveLength(0)
  })
})

describe('defects', () => {
  let stopDefectId: string

  it('catalogue has 18 items in the user locale', async () => {
    const res = await request(server).get('/api/v1/defects/catalog').set(bearer(A.ownerToken))
    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(18)
    expect(res.body.items[16]).toMatchObject({ code: '17', stopLift: true, ref: 'т. 17' })
    expect(res.body.items[16].label).toContain('гласова')
  })

  it('a stop-lift catalogue defect stops the elevator and sets the follow-up date', async () => {
    const res = await request(server)
      .post('/api/v1/defects')
      .set(bearer(techToken))
      .send({ elevatorId, catalogCode: '17', sourceType: 'visit' })
    expect(res.status, res.text).toBe(201)
    stopDefectId = res.body.id
    expect(res.body.stopLift).toBe(true)
    expect(res.body.catalogRef).toBe('т. 17')
    expect(res.body.description).toContain('гласова връзка')
    expect(res.body.status).toBe('open')
    expect(res.body.followUpDueAt).toBe(addDays(today, 30))
    expect(res.body.followUpInDays).toBe(30)

    const e = await request(server).get(`/api/v1/elevators/${elevatorId}`).set(bearer(A.ownerToken))
    expect(e.body.status).toBe('stopped_by_firm')
    expect(e.body.stoppedAt).toBeTruthy()
    expect(e.body.stopReason).toContain('т. 17')
    const auditRows = await prismaBase.auditLog.findMany({
      where: { tenantId: A.tenantId, action: 'elevator.setStatus', entityId: elevatorId },
    })
    expect(auditRows.length).toBeGreaterThanOrEqual(1)

    const dash = await request(server).get('/api/v1/dashboard').set(bearer(A.ownerToken))
    const pin = dash.body.pins.find((p: { elevatorId: string }) => p.elevatorId === elevatorId)
    expect(pin.stopLift).toBe(true)
    expect(pin.state).toBe('stopped')
    expect(dash.body.defects.open).toBeGreaterThanOrEqual(1)
    expect(dash.body.defects.stopLift).toBe(1)
  })

  it('free text needs a description; "other" does not stop the lift', async () => {
    const bad = await request(server)
      .post('/api/v1/defects')
      .set(bearer(A.ownerToken))
      .send({ elevatorId: elevator2Id })
    expect(bad.status).toBe(400)
    const ok = await request(server).post('/api/v1/defects').set(bearer(A.ownerToken)).send({
      elevatorId: elevator2Id,
      catalogCode: 'other',
      description: 'Пукнато огледало',
      severity: 'low',
    })
    expect(ok.status).toBe(201)
    expect(ok.body.stopLift).toBe(false)
    const e = await request(server)
      .get(`/api/v1/elevators/${elevator2Id}`)
      .set(bearer(A.ownerToken))
    expect(e.body.status).toBe('active')
  })

  it('notice sent -> awaiting approval -> resolved restores the elevator; technicians cannot PATCH', async () => {
    const forbidden = await request(server)
      .patch(`/api/v1/defects/${stopDefectId}`)
      .set(bearer(techToken))
      .send({ status: 'notified' })
    expect(forbidden.status).toBe(403)

    const notified = await request(server)
      .patch(`/api/v1/defects/${stopDefectId}`)
      .set(bearer(A.ownerToken))
      .send({ status: 'notified' })
    expect(notified.status, notified.text).toBe(200)
    expect(notified.body.noticeSentAt).toBeTruthy()

    const awaiting = await request(server)
      .patch(`/api/v1/defects/${stopDefectId}`)
      .set(bearer(A.ownerToken))
      .send({ status: 'awaiting_approval' })
    expect(awaiting.body.customerRequestedAt).toBeTruthy()

    const list = await request(server)
      .get('/api/v1/defects?status=awaiting_approval')
      .set(bearer(A.ownerToken))
    expect(list.body.items.map((d: { id: string }) => d.id)).toEqual([stopDefectId])
    const followUp = await request(server)
      .get(`/api/v1/defects?followUpDue=true&to=${addDays(today, 31)}`)
      .set(bearer(A.ownerToken))
    expect(followUp.body.items.map((d: { id: string }) => d.id)).toContain(stopDefectId)
    const notYet = await request(server)
      .get('/api/v1/defects?followUpDue=true')
      .set(bearer(A.ownerToken))
    expect(notYet.body.items).toHaveLength(0)

    const resolved = await request(server)
      .patch(`/api/v1/defects/${stopDefectId}`)
      .set(bearer(A.ownerToken))
      .send({ status: 'resolved' })
    expect(resolved.status).toBe(200)
    expect(resolved.body.resolvedAt).toBeTruthy()
    const e = await request(server).get(`/api/v1/elevators/${elevatorId}`).set(bearer(A.ownerToken))
    expect(e.body.status).toBe('active')
    expect(e.body.stoppedAt).toBeNull()

    const reopen = await request(server)
      .patch(`/api/v1/defects/${stopDefectId}`)
      .set(bearer(A.ownerToken))
      .send({ status: 'open' })
    expect(reopen.status).toBe(409)

    const perElevator = await request(server)
      .get(`/api/v1/elevators/${elevatorId}/defects`)
      .set(bearer(A.ownerToken))
    expect(perElevator.body.items).toHaveLength(1)
  })

  it('two open stop-lift defects: the elevator stays stopped until the last one is resolved', async () => {
    const d1 = await request(server)
      .post('/api/v1/defects')
      .set(bearer(A.ownerToken))
      .send({ elevatorId, catalogCode: '11' })
    const d2 = await request(server)
      .post('/api/v1/defects')
      .set(bearer(A.ownerToken))
      .send({ elevatorId, catalogCode: '12' })
    await request(server)
      .patch(`/api/v1/defects/${d1.body.id}`)
      .set(bearer(A.ownerToken))
      .send({ status: 'resolved' })
    let e = await request(server).get(`/api/v1/elevators/${elevatorId}`).set(bearer(A.ownerToken))
    expect(e.body.status).toBe('stopped_by_firm')
    await request(server)
      .patch(`/api/v1/defects/${d2.body.id}`)
      .set(bearer(A.ownerToken))
      .send({ status: 'resolved' })
    e = await request(server).get(`/api/v1/elevators/${elevatorId}`).set(bearer(A.ownerToken))
    expect(e.body.status).toBe('active')
  })

  it('tenant isolation', async () => {
    expect(
      (await request(server).get(`/api/v1/defects/${stopDefectId}`).set(bearer(B.ownerToken)))
        .status,
    ).toBe(404)
    expect(
      (
        await request(server)
          .patch(`/api/v1/defects/${stopDefectId}`)
          .set(bearer(B.ownerToken))
          .send({ status: 'notified' })
      ).status,
    ).toBe(404)
    expect(
      (
        await request(server)
          .get(`/api/v1/elevators/${elevatorId}/defects`)
          .set(bearer(B.ownerToken))
      ).status,
    ).toBe(404)
    expect(
      (
        await request(server)
          .post('/api/v1/defects')
          .set(bearer(B.ownerToken))
          .send({ elevatorId, catalogCode: '1' })
      ).status,
    ).toBe(404)
  })
})

describe('inspections, alarm tests and the calendar', () => {
  let inspectionId: string

  it('first performed inspection: next due +24 months, elevator.nextInspectionAt follows', async () => {
    const res = await request(server).post('/api/v1/inspections').set(bearer(A.ownerToken)).send({
      elevatorId,
      kind: 'periodic',
      performedAt: '2026-03-10',
      result: 'passed',
      inspectionBody: 'ОТП Тест',
    })
    expect(res.status, res.text).toBe(201)
    inspectionId = res.body.id
    expect(res.body.nextDueAt).toBe('2028-03-10')
    const e = await request(server).get(`/api/v1/elevators/${elevatorId}`).set(bearer(A.ownerToken))
    expect(e.body.nextInspectionAt).toBe('2028-03-10')
  })

  it('second inspection: +12 months; explicit nextDueAt wins; failed has none; pending needs no result', async () => {
    const second = await request(server)
      .post('/api/v1/inspections')
      .set(bearer(A.ownerToken))
      .send({
        elevatorId,
        performedAt: '2026-09-01',
        result: 'passed_with_defects',
        defects: [{ text: 'Да се смени осветлението', deadline: '2026-10-01' }],
      })
    expect(second.status).toBe(201)
    expect(second.body.nextDueAt).toBe('2027-09-01')
    expect(second.body.defects[0].closed).toBe(false)
    const e = await request(server).get(`/api/v1/elevators/${elevatorId}`).set(bearer(A.ownerToken))
    expect(e.body.nextInspectionAt).toBe('2027-09-01')

    const explicit = await request(server)
      .patch(`/api/v1/inspections/${second.body.id}`)
      .set(bearer(A.ownerToken))
      .send({ nextDueAt: '2027-06-30' })
    expect(explicit.body.nextDueAt).toBe('2027-06-30')
    const e2 = await request(server)
      .get(`/api/v1/elevators/${elevatorId}`)
      .set(bearer(A.ownerToken))
    expect(e2.body.nextInspectionAt).toBe('2027-06-30')

    const failed = await request(server)
      .post('/api/v1/inspections')
      .set(bearer(A.ownerToken))
      .send({ elevatorId: elevator2Id, performedAt: '2026-08-01', result: 'failed' })
    expect(failed.body.nextDueAt).toBeNull()
    const pendingBad = await request(server)
      .post('/api/v1/inspections')
      .set(bearer(A.ownerToken))
      .send({ elevatorId: elevator2Id, performedAt: '2026-08-01', result: 'pending' })
    expect(pendingBad.status).toBe(400)
    const scheduled = await request(server)
      .post('/api/v1/inspections')
      .set(bearer(A.ownerToken))
      .send({ elevatorId: elevator2Id, scheduledAt: addDays(today, 5), requestedAt: today })
    expect(scheduled.status).toBe(201)
    expect(scheduled.body.result).toBe('pending')

    const list = await request(server)
      .get(`/api/v1/elevators/${elevatorId}/inspections`)
      .set(bearer(A.ownerToken))
    expect(list.body.items).toHaveLength(2)
    const all = await request(server)
      .get('/api/v1/inspections?result=pending')
      .set(bearer(A.ownerToken))
    expect(all.body.items).toHaveLength(1)
    expect(
      (
        await request(server)
          .post('/api/v1/inspections')
          .set(bearer(techToken))
          .send({ elevatorId })
      ).status,
    ).toBe(403)
  })

  it('alarm tests are logged per elevator', async () => {
    const res = await request(server)
      .post(`/api/v1/elevators/${elevatorId}/alarm-tests`)
      .set(bearer(techToken))
      .send({ ok: false, notes: 'Слаб сигнал' })
    expect(res.status).toBe(201)
    expect(res.body.byUserName).toBe('Иван Техник')
    const list = await request(server)
      .get(`/api/v1/elevators/${elevatorId}/alarm-tests`)
      .set(bearer(A.ownerToken))
    expect(list.body.items).toHaveLength(1)
    const future = await request(server)
      .post(`/api/v1/elevators/${elevatorId}/alarm-tests`)
      .set(bearer(A.ownerToken))
      .send({ testedAt: new Date(Date.now() + 7_200_000).toISOString() })
    expect(future.status).toBe(400)
  })

  it('the calendar merges inspections, overdue checks, defect follow-ups, breached callbacks and alarm tests', async () => {
    // elevator 1: lastCheckAt 45 days ago with a 30-day interval -> check overdue
    // defect follow-up: a fresh open defect due in 30 days; breached callback from the callbacks block
    const openDefect = await request(server)
      .post('/api/v1/defects')
      .set(bearer(A.ownerToken))
      .send({ elevatorId: elevator2Id, catalogCode: 'other', description: 'Шум' })
    expect(openDefect.status).toBe(201)
    await request(server)
      .patch('/api/v1/tenant')
      .set(bearer(A.ownerToken))
      .send({ settings: { alarmTestIntervalMonths: 6 } })

    const res = await request(server)
      .get(`/api/v1/calendar?to=${addDays(today, 400)}`)
      .set(bearer(A.ownerToken))
    expect(res.status, res.text).toBe(200)
    const kinds = new Set(res.body.items.map((i: { kind: string }) => i.kind))
    expect(kinds).toContain('inspection_due')
    expect(kinds).toContain('check_overdue')
    expect(kinds).toContain('defect_follow_up')
    expect(kinds).toContain('callback_sla')
    expect(kinds).toContain('alarm_test_due')
    const check = res.body.items.find(
      (i: { kind: string; elevatorId: string }) =>
        i.kind === 'check_overdue' && i.elevatorId === elevatorId,
    )
    expect(check.severity).toBe('overdue')
    expect(check.inDays).toBeLessThan(0)
    const sched = res.body.items.find(
      (i: { kind: string; refType: string }) =>
        i.kind === 'inspection_due' && i.refType === 'inspection',
    )
    expect(sched.dueAt).toBe(addDays(today, 5))
    expect(sched.title).toContain('периодичен')
    const alarm = res.body.items.filter((i: { kind: string }) => i.kind === 'alarm_test_due')
    // elevator 2 never tested -> due today; elevator 1 tested today -> in 6 months
    expect(
      alarm.some(
        (i: { elevatorId: string; dueAt: string }) =>
          i.elevatorId === elevator2Id && i.dueAt === today,
      ),
    ).toBe(true)
    expect(res.body.counts.total).toBe(res.body.items.length)
    // sorted by date
    const dates = res.body.items.map((i: { dueAt: string }) => i.dueAt)
    expect([...dates].sort()).toEqual(dates)

    const filtered = await request(server)
      .get('/api/v1/calendar?kinds=check_overdue&includeOverdue=false')
      .set(bearer(A.ownerToken))
    expect(filtered.body.items).toHaveLength(0)
    const onlyChecks = await request(server)
      .get('/api/v1/calendar?kinds=check_overdue')
      .set(bearer(A.ownerToken))
    expect(onlyChecks.body.items.every((i: { kind: string }) => i.kind === 'check_overdue')).toBe(
      true,
    )

    const dash = await request(server).get('/api/v1/dashboard').set(bearer(A.ownerToken))
    expect(dash.body.deadlines.days).toBe(30)
    expect(dash.body.deadlines.byKind.check_overdue).toBeGreaterThanOrEqual(1)
    expect(dash.body.callbacks.open).toBe(1)
    expect(dash.body.callbacks.breached).toBe(1)
    expect(dash.body.callbacks.oldest.slaState).toBe('breached')
    const empty = await request(server).get('/api/v1/calendar').set(bearer(B.ownerToken))
    expect(empty.body.items).toHaveLength(0)
  })

  it('tenant isolation for inspections and alarm tests', async () => {
    expect(
      (await request(server).get(`/api/v1/inspections/${inspectionId}`).set(bearer(B.ownerToken)))
        .status,
    ).toBe(404)
    expect(
      (
        await request(server)
          .patch(`/api/v1/inspections/${inspectionId}`)
          .set(bearer(B.ownerToken))
          .send({ notes: 'x' })
      ).status,
    ).toBe(404)
    expect(
      (
        await request(server)
          .get(`/api/v1/elevators/${elevatorId}/inspections`)
          .set(bearer(B.ownerToken))
      ).status,
    ).toBe(404)
    expect(
      (
        await request(server)
          .post(`/api/v1/elevators/${elevatorId}/alarm-tests`)
          .set(bearer(B.ownerToken))
          .send({})
      ).status,
    ).toBe(404)
    expect(
      (
        await request(server)
          .get(`/api/v1/elevators/${elevatorId}/alarm-tests`)
          .set(bearer(B.ownerToken))
      ).status,
    ).toBe(404)
  })
})

describe('public QR page and fault report', () => {
  let token: string
  let publicUrl: string

  it('the elevator carries a 32-hex public token and an absolute public URL', async () => {
    const e = await request(server).get(`/api/v1/elevators/${elevatorId}`).set(bearer(A.ownerToken))
    token = e.body.publicToken
    publicUrl = e.body.publicUrl
    expect(token).toMatch(/^[0-9a-f]{32}$/)
    expect(publicUrl).toBe(`http://localhost:3005/p/${token}`)
  })

  it('answers 404 while the feature flag is off, 200 once the owner enables it', async () => {
    expect((await request(server).get(`/p/${token}`)).status).toBe(404)
    const set = await request(server)
      .patch('/api/v1/tenant')
      .set(bearer(A.ownerToken))
      .send({ features: { publicQrPage: true } })
    expect(set.status).toBe(200)
    expect(set.body.features).toEqual({ publicQrPage: true, publicFaultReport: false })
    const res = await request(server).get(`/p/${token}`)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
    expect(res.text).toContain('0700 11 111')
    expect(res.text).toContain('tel:070011111')
    expect(res.text).toContain('вх. А, ляв')
    expect(res.text).toContain('ж.к. Тест')
    expect(res.text).not.toContain('name="description"')
    expect(res.text).toContain('в експлоатация')
    expect((await request(server).get('/p/not-a-token')).status).toBe(404)
    expect((await request(server).get(`/p/${'0'.repeat(32)}`)).status).toBe(404)
  })

  it('the fault form creates a public_page callback; the honeypot is silently ignored', async () => {
    await request(server)
      .patch('/api/v1/tenant')
      .set(bearer(A.ownerToken))
      .send({ features: { publicFaultReport: true } })
    const pageRes = await request(server).get(`/p/${token}`)
    expect(pageRes.text).toContain('name="description"')
    resetElevatorLimits()
    const before = (
      await request(server).get('/api/v1/callbacks?open=true').set(bearer(A.ownerToken))
    ).body.items.length

    const bot = await request(server)
      .post(`/p/${token}/report`)
      .type('form')
      .send({ website: 'http://spam', description: 'buy stuff' })
    expect(bot.status).toBe(200)

    const ok = await request(server).post(`/p/${token}/report`).type('form').send({
      name: 'Живущ',
      phone: '0899 111 222',
      description: 'Асансьорът не тръгва',
      trapped: '1',
    })
    expect(ok.status).toBe(200)
    expect(ok.text).toContain('Сигналът е получен')

    const list = await request(server).get('/api/v1/callbacks?open=true').set(bearer(A.ownerToken))
    expect(list.body.items.length).toBe(before + 1)
    const cb = list.body.items[0]
    expect(cb.channel).toBe('public_page')
    expect(cb.classification).toBe('trapped_persons')
    expect(cb.callerName).toBe('Живущ')
    expect(cb.callerPhone).toBe('0899 111 222')
    expect(cb.source).toBe('public')
    const detail = await request(server).get(`/api/v1/callbacks/${cb.id}`).set(bearer(A.ownerToken))
    expect(detail.body.events[0].source).toBe('public')
    expect(detail.body.events[0].byUserId).toBeNull()

    const short = await request(server)
      .post(`/p/${token}/report`)
      .type('form')
      .send({ description: 'x' })
    expect(short.status).toBe(400)
  })

  it('limits reports to 5 per elevator per hour', async () => {
    resetElevatorLimits()
    for (let i = 0; i < 5; i++) {
      const r = await request(server)
        .post(`/p/${token}/report`)
        .type('form')
        .send({ description: `Сигнал ${i}` })
      expect(r.status).toBe(200)
    }
    const sixth = await request(server)
      .post(`/p/${token}/report`)
      .type('form')
      .send({ description: 'Още един' })
    expect(sixth.status).toBe(429)
    resetElevatorLimits()
  })

  it('rotating the token kills the old page', async () => {
    const rotated = await request(server)
      .post(`/api/v1/elevators/${elevatorId}/rotate-token`)
      .set(bearer(A.ownerToken))
    expect(rotated.status).toBe(200)
    expect(rotated.body.publicToken).not.toBe(token)
    expect((await request(server).get(`/p/${token}`)).status).toBe(404)
    expect((await request(server).get(`/p/${rotated.body.publicToken}`)).status).toBe(200)
    expect(
      (
        await request(server)
          .post(`/api/v1/elevators/${elevatorId}/rotate-token`)
          .set(bearer(techToken))
      ).status,
    ).toBe(403)
    expect(
      (
        await request(server)
          .post(`/api/v1/elevators/${elevatorId}/rotate-token`)
          .set(bearer(B.ownerToken))
      ).status,
    ).toBe(404)
  })
})

describe('printable pages', () => {
  let defectId: string

  beforeAll(async () => {
    const d = await request(server).post('/api/v1/defects').set(bearer(A.ownerToken)).send({
      elevatorId: elevator2Id,
      catalogCode: '4',
      notes: 'Стъклото е счупено от външната страна.',
    })
    defectId = d.body.id
  })

  it('defect notice: office only, HTML with the firm, the building and the defect', async () => {
    expect((await request(server).get(`/print/defect-notice/${defectId}`)).status).toBe(401)
    expect(
      (await request(server).get(`/print/defect-notice/${defectId}`).set(bearer(techToken))).status,
    ).toBe(403)
    expect(
      (await request(server).get(`/print/defect-notice/${defectId}`).set(bearer(B.ownerToken)))
        .status,
    ).toBe(404)
    const res = await request(server)
      .get(`/print/defect-notice/${defectId}`)
      .set(bearer(A.ownerToken))
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
    expect(res.text).toContain('Уведомление за констатиран дефект')
    expect(res.text).toContain('т. 4')
    expect(res.text).toContain('стъкло')
    expect(res.text).toContain('Alpha 1')
    expect(res.text).toContain('ЕС Алфа')
    expect(res.text).toContain('спрян от експлоатация')
    expect(res.text).toContain('../assets/print.js')
    expect((await request(server).get('/print/assets/print.js')).status).toBe(200)
  })

  it('inspection request letter and QR labels', async () => {
    const letter = await request(server)
      .get(`/print/inspection-request/${elevatorId}?from=2027-06-01&to=2027-06-20`)
      .set(bearer(A.ownerToken))
    expect(letter.status).toBe(200)
    expect(letter.text).toContain('технически преглед')
    expect(letter.text).toContain('2027')
    const label = await request(server).get(`/print/label/${elevatorId}`).set(bearer(techToken))
    expect(label.status).toBe(200)
    expect(label.text).toContain('<svg')
    expect(label.text).toContain('0700 11 111')
    expect(label.text).toContain('вх. А, ляв')
    const sheet = await request(server)
      .get(`/print/labels/building/${buildingId}`)
      .set(bearer(A.ownerToken))
    expect(sheet.status).toBe(200)
    expect(sheet.text.match(/class="label"/g)?.length).toBe(2)
    expect(
      (await request(server).get(`/print/label/${elevatorId}`).set(bearer(B.ownerToken))).status,
    ).toBe(404)
  })
})
