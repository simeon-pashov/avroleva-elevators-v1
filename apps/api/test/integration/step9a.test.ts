import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import request from 'supertest'
import type { Express } from 'express'
import type { DayPlanDto, PlanStopDto } from '@avroleva/contracts'
import { disconnectDb, prismaBase } from '../../src/platform/db/prisma.js'
import { addDays, todayInSofia } from '../../src/platform/clock.js'
import { runJob } from '../../src/platform/jobs/registry.js'
import { registerSubscribers } from '../../src/subscribers.js'
import { ensureJobsRegistered } from '../../src/worker.js'
import { checklists, sofiaLocalToUtc } from '../../src/modules/maintenance/index.js'
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
let bIn: string
let bDistrict: string
let bOther: string
let e1: string
let e2: string
let e3: string
let bElevatorId: string
let tech1: string
let tech2: string
let tech1Token: string
let tech2Token: string
let officeToken: string
let defaultZoneId: string
let mladostZoneId: string
let druzhbaZoneId: string
let pair1: string
let pair2: string
let jobId: string
let callbackId: string
let inspectionId: string
let plan1: string
let plan2: string

const today = todayInSofia()
const tomorrow = addDays(today, 1)
const BASE = { lat: 42.6605, lng: 23.3746 }
const IN = { lat: 42.65, lng: 23.38 }
const OTHER = { lat: 42.72, lng: 23.26 }
const SQUARE = {
  type: 'Polygon',
  coordinates: [
    [
      [23.36, 42.63],
      [23.4, 42.63],
      [23.4, 42.67],
      [23.36, 42.67],
      [23.36, 42.63],
    ],
  ],
}
const appHeaders = (token: string) => ({
  ...bearer(token),
  'X-Client': 'app',
  'X-Client-Version': '0.5.0',
})

async function createUser(name: string, role: 'technician' | 'office') {
  const username = `${role}9_${Math.floor(Math.random() * 1e6)}`
  const res = await request(server)
    .post('/api/v1/users')
    .set(bearer(A.ownerToken))
    .send({ username, password: 'password123', name, role })
  expect(res.status, res.text).toBe(201)
  const login = await request(server)
    .post('/api/v1/auth/login')
    .set(CSRF)
    .send({ username, password: 'password123' })
  expect(login.status, login.text).toBe(200)
  return { id: res.body.id as string, token: login.body.token as string }
}

async function createLift(buildingId: string, internalNo: string, lastCheckAt: string) {
  const res = await request(server)
    .post('/api/v1/elevators')
    .set(bearer(A.ownerToken))
    .send({ buildingId, internalNo, stops: 8, lastCheckAt })
  expect(res.status, res.text).toBe(201)
  return res.body.id as string
}

async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, ms = 5000): Promise<T> {
  const end = Date.now() + ms
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() > end) throw new Error('waitFor timed out')
    await new Promise((r) => setTimeout(r, 50))
  }
}

const refs = (p: DayPlanDto) => p.stops.map((s) => `${s.kind}:${s.refId}`)

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
  A = await createTenant(server, 'Plan A')
  B = await createTenant(server, 'Plan B')
  customerId = (await createCustomer(server, A.ownerToken, 'ЕС „Младост 1“')).id
  const mk = async (address: object, coords: { lat: number; lng: number } | null) => {
    const res = await request(server)
      .post('/api/v1/buildings')
      .set(bearer(A.ownerToken))
      .send({ customerId, address, ...(coords ?? {}) })
    expect(res.status, res.text).toBe(201)
    return res.body.id as string
  }
  bIn = await mk({ city: 'София', district: 'ж.к. Младост 1', block: '25', entrance: 'А' }, IN)
  bDistrict = await mk({ city: 'София', district: 'ж.к. Дружба 2', block: '301' }, null)
  bOther = await mk({ city: 'София', district: 'Люлин', block: '7' }, OTHER)
  await request(server)
    .post('/api/v1/contacts')
    .set(bearer(A.ownerToken))
    .send({
      buildingId: bIn,
      customerId,
      name: 'Петя Димова',
      role: 'house_manager',
      phone: '0888 123 456',
      isPrimary: true,
    })
    .expect(201)
  // e1 overdue, e2 due today, e3 due in 5 days (30-day default interval).
  e1 = await createLift(bIn, 'вх. А', addDays(today, -45))
  e2 = await createLift(bDistrict, 'вх. Б', addDays(today, -30))
  e3 = await createLift(bOther, 'вх. В', addDays(today, -25))
  bElevatorId = (
    await createElevator(
      server,
      B.ownerToken,
      (await createBuilding(server, B.ownerToken, 'ж.к. Дружба', '9')).id,
    )
  ).id
  const t1 = await createUser('Иван Петров', 'technician')
  const t2 = await createUser('Петър Илиев', 'technician')
  const office = await createUser('Мария', 'office')
  tech1 = t1.id
  tech1Token = t1.token
  tech2 = t2.id
  tech2Token = t2.token
  officeToken = office.token
  const settings = await request(server)
    .patch('/api/v1/tenant')
    .set(bearer(A.ownerToken))
    .send({
      settings: {
        planning: {
          baseAddress: 'София, ул. Индустриална 11',
          baseLat: BASE.lat,
          baseLng: BASE.lng,
          avgStopMinutes: 25,
          avgSpeedKmh: 25,
          dayStart: '08:30',
        },
      },
    })
  expect(settings.status, settings.text).toBe(200)
  expect(settings.body.settings.planning.baseLat).toBe(BASE.lat)
})

afterAll(async () => {
  await disconnectDb()
})

describe('zones (Райони)', () => {
  it('the default zone appears lazily and holds every building', async () => {
    const res = await request(server).get('/api/v1/zones').set(bearer(A.ownerToken))
    expect(res.status, res.text).toBe(200)
    expect(res.body.items).toHaveLength(1)
    const z = res.body.items[0]
    expect(z).toMatchObject({ name: 'Всички', isDefault: true, buildingCount: 3, polygon: null })
    defaultZoneId = z.id
    const b = await request(server).get(`/api/v1/buildings/${bIn}`).set(bearer(A.ownerToken))
    expect(b.body).toMatchObject({ zoneId: defaultZoneId, zoneName: 'Всички', zoneManual: false })
  })

  it('a polygon zone captures the building inside it; a district zone matches by name', async () => {
    const poly = await request(server)
      .post('/api/v1/zones')
      .set(bearer(officeToken))
      .send({ name: 'Младост', colour: '#16a34a', polygon: SQUARE })
    expect(poly.status, poly.text).toBe(201)
    expect(poly.body).toMatchObject({ name: 'Младост', buildingCount: 1, isDefault: false })
    mladostZoneId = poly.body.id
    const byDistrict = await request(server)
      .post('/api/v1/zones')
      .set(bearer(A.ownerToken))
      .send({ name: 'Дружба', districts: ['Дружба 2'] })
    expect(byDistrict.status, byDistrict.text).toBe(201)
    expect(byDistrict.body.buildingCount).toBe(1)
    druzhbaZoneId = byDistrict.body.id
    const inside = await request(server).get(`/api/v1/buildings/${bIn}`).set(bearer(A.ownerToken))
    expect(inside.body).toMatchObject({ zoneId: mladostZoneId, zoneName: 'Младост' })
    const district = await request(server)
      .get(`/api/v1/buildings/${bDistrict}`)
      .set(bearer(A.ownerToken))
    expect(district.body).toMatchObject({ zoneId: druzhbaZoneId, zoneName: 'Дружба' })
    const other = await request(server).get(`/api/v1/buildings/${bOther}`).set(bearer(A.ownerToken))
    expect(other.body.zoneId).toBe(defaultZoneId)
    const list = await request(server)
      .get(`/api/v1/buildings?zoneId=${mladostZoneId}`)
      .set(bearer(A.ownerToken))
    expect(list.body.items.map((b: { id: string }) => b.id)).toEqual([bIn])
    const zones = await request(server).get('/api/v1/zones').set(bearer(tech1Token))
    expect(zones.body.items.map((z: { name: string }) => z.name)).toEqual([
      'Младост',
      'Дружба',
      'Всички',
    ])
  })

  it('moving the pin re-assigns; a manual override sticks through recompute until cleared', async () => {
    const moved = await request(server)
      .patch(`/api/v1/buildings/${bOther}`)
      .set(bearer(A.ownerToken))
      .send({ lat: 42.66, lng: 23.37 })
    expect(moved.status, moved.text).toBe(200)
    expect(moved.body).toMatchObject({ zoneId: mladostZoneId, zoneManual: false })
    const back = await request(server)
      .patch(`/api/v1/buildings/${bOther}`)
      .set(bearer(A.ownerToken))
      .send({ lat: OTHER.lat, lng: OTHER.lng })
    expect(back.body.zoneId).toBe(defaultZoneId)
    const manual = await request(server)
      .patch(`/api/v1/buildings/${bOther}`)
      .set(bearer(A.ownerToken))
      .send({ zoneId: mladostZoneId })
    expect(manual.status, manual.text).toBe(200)
    expect(manual.body).toMatchObject({ zoneId: mladostZoneId, zoneManual: true })
    const recompute = await request(server)
      .post('/api/v1/zones/recompute')
      .set(bearer(A.ownerToken))
    expect(recompute.status, recompute.text).toBe(200)
    expect(recompute.body).toEqual({ changed: 0, total: 2 })
    const still = await request(server).get(`/api/v1/buildings/${bOther}`).set(bearer(A.ownerToken))
    expect(still.body).toMatchObject({ zoneId: mladostZoneId, zoneManual: true })
    const cleared = await request(server)
      .patch(`/api/v1/buildings/${bOther}`)
      .set(bearer(A.ownerToken))
      .send({ zoneId: null })
    expect(cleared.body).toMatchObject({ zoneId: defaultZoneId, zoneManual: false })
    await request(server)
      .patch(`/api/v1/buildings/${bOther}`)
      .set(bearer(A.ownerToken))
      .send({ zoneId: randomUUID() })
      .expect(404)
    const cron = (await runJob('registry.recomputeZones')) as Record<string, { changed: number }>
    expect(cron[A.tenantId]).toEqual({ changed: 0, total: 3 })
  })

  it('the default zone can be renamed but not deleted; deleting a zone re-assigns its buildings', async () => {
    const renamed = await request(server)
      .patch(`/api/v1/zones/${defaultZoneId}`)
      .set(bearer(A.ownerToken))
      .send({ name: 'Останалите' })
    expect(renamed.status, renamed.text).toBe(200)
    expect(renamed.body.name).toBe('Останалите')
    const del = await request(server)
      .delete(`/api/v1/zones/${defaultZoneId}`)
      .set(bearer(A.ownerToken))
    expect(del.status).toBe(409)
    expect(del.body.code).toBe('zones.isDefault')
    await request(server)
      .delete(`/api/v1/zones/${druzhbaZoneId}`)
      .set(bearer(A.ownerToken))
      .expect(204)
    const b = await request(server).get(`/api/v1/buildings/${bDistrict}`).set(bearer(A.ownerToken))
    expect(b.body.zoneId).toBe(defaultZoneId)
    const zones = await request(server).get('/api/v1/zones').set(bearer(A.ownerToken))
    expect(zones.body.items.map((z: { name: string }) => z.name)).toEqual(['Младост', 'Останалите'])
  })
})

describe('technician pairs (екипи)', () => {
  it('owner creates pairs; validation of users and the home zone', async () => {
    const dup = await request(server)
      .post('/api/v1/technician-pairs')
      .set(bearer(A.ownerToken))
      .send({ name: 'x', userIds: [tech1, tech1] })
    expect(dup.status).toBe(400)
    expect(dup.body.code).toBe('pairs.duplicateUsers')
    const unknown = await request(server)
      .post('/api/v1/technician-pairs')
      .set(bearer(A.ownerToken))
      .send({ name: 'x', userIds: [randomUUID()] })
    expect(unknown.status).toBe(400)
    expect(unknown.body.code).toBe('pairs.userNotFound')
    const badZone = await request(server)
      .post('/api/v1/technician-pairs')
      .set(bearer(A.ownerToken))
      .send({ name: 'x', userIds: [tech1], defaultZoneId: druzhbaZoneId })
    expect(badZone.status).toBe(400)
    expect(badZone.body.code).toBe('pairs.zoneNotFound')
    const p1 = await request(server)
      .post('/api/v1/technician-pairs')
      .set(bearer(A.ownerToken))
      .send({
        name: 'Екип 1',
        userIds: [tech1],
        vehicle: 'СА 1234 ВХ',
        defaultZoneId: mladostZoneId,
      })
    expect(p1.status, p1.text).toBe(201)
    expect(p1.body).toMatchObject({
      name: 'Екип 1',
      userNames: ['Иван Петров'],
      defaultZoneId: mladostZoneId,
      position: 0,
      active: true,
    })
    pair1 = p1.body.id
    const p2 = await request(server)
      .post('/api/v1/technician-pairs')
      .set(bearer(A.ownerToken))
      .send({ name: 'Екип 2', userIds: [tech2] })
    expect(p2.status, p2.text).toBe(201)
    expect(p2.body.position).toBe(1)
    pair2 = p2.body.id
    const list = await request(server).get('/api/v1/technician-pairs').set(bearer(tech1Token))
    expect(list.body.items.map((p: { name: string }) => p.name)).toEqual(['Екип 1', 'Екип 2'])
    const upd = await request(server)
      .patch(`/api/v1/technician-pairs/${pair2}`)
      .set(bearer(A.ownerToken))
      .send({ vehicle: 'СА 5678 КХ' })
    expect(upd.body.vehicle).toBe('СА 5678 КХ')
    await request(server)
      .post('/api/v1/technician-pairs')
      .set(bearer(officeToken))
      .send({ name: 'x', userIds: [tech1] })
      .expect(403)
    await request(server)
      .post('/api/v1/technician-pairs')
      .set(bearer(tech1Token))
      .send({ name: 'x', userIds: [tech1] })
      .expect(403)
    const spare = await request(server)
      .post('/api/v1/technician-pairs')
      .set(bearer(A.ownerToken))
      .send({ name: 'Резерва', userIds: [tech2] })
    await request(server)
      .delete(`/api/v1/technician-pairs/${spare.body.id}`)
      .set(bearer(A.ownerToken))
      .expect(204)
    const after = await request(server).get('/api/v1/technician-pairs').set(bearer(A.ownerToken))
    expect(after.body.items).toHaveLength(2)
  })
})

describe('day plans (План за деня)', () => {
  it('sets up the work of tomorrow: a scheduled job, an open callback, a pending inspection', async () => {
    const job = await request(server)
      .post('/api/v1/jobs')
      .set(bearer(A.ownerToken))
      .send({
        elevatorId: e1,
        title: 'Смяна на ролки',
        lines: [{ description: 'Ролка', qty: 4, unitCents: 3000 }],
      })
    expect(job.status, job.text).toBe(201)
    jobId = job.body.id
    await request(server).post(`/api/v1/jobs/${jobId}/quote`).set(bearer(A.ownerToken)).expect(200)
    await request(server)
      .post(`/api/v1/jobs/${jobId}/send-quote`)
      .set(bearer(A.ownerToken))
      .send({ channel: 'none' })
      .expect(200)
    await request(server)
      .post(`/api/v1/jobs/${jobId}/transition`)
      .set(bearer(A.ownerToken))
      .send({ to: 'approved', evidence: { kind: 'verbal', by: 'домоуправител' } })
      .expect(200)
    const scheduled = await request(server)
      .post(`/api/v1/jobs/${jobId}/schedule`)
      .set(bearer(A.ownerToken))
      .send({
        scheduledAt: sofiaLocalToUtc(tomorrow, '10:00').toISOString(),
        assignedUserIds: [tech2],
      })
    expect(scheduled.status, scheduled.text).toBe(200)
    const cb = await request(server)
      .post('/api/v1/callbacks')
      .set(bearer(A.ownerToken))
      .send({ elevatorId: e2, description: 'Не тръгва от партера' })
    expect(cb.status, cb.text).toBe(201)
    callbackId = cb.body.id
    const insp = await request(server)
      .post('/api/v1/inspections')
      .set(bearer(A.ownerToken))
      .send({ elevatorId: e3, kind: 'periodic', scheduledAt: tomorrow, result: 'pending' })
    expect(insp.status, insp.text).toBe(201)
    inspectionId = insp.body.id
  })

  it('refuses a past date, a tenant without pairs and technicians', async () => {
    const past = await request(server)
      .post('/api/v1/day-plans/generate')
      .set(bearer(A.ownerToken))
      .send({ date: addDays(today, -1) })
    expect(past.status).toBe(400)
    expect(past.body.code).toBe('dayPlan.dateInPast')
    const noPairs = await request(server)
      .post('/api/v1/day-plans/generate')
      .set(bearer(B.ownerToken))
      .send({ date: tomorrow })
    expect(noPairs.status).toBe(409)
    expect(noPairs.body.code).toBe('dayPlan.noPairs')
    await request(server)
      .post('/api/v1/day-plans/generate')
      .set(bearer(tech1Token))
      .send({ date: tomorrow })
      .expect(403)
  })

  it('generates for one zone: only that zone`s pairs and buildings; the rest is unplanned', async () => {
    const res = await request(server)
      .post('/api/v1/day-plans/generate')
      .set(bearer(officeToken))
      .send({ date: tomorrow, zoneId: mladostZoneId })
    expect(res.status, res.text).toBe(200)
    expect(res.body).toMatchObject({ created: 1, regenerated: 0, keptLocked: 0 })
    const board = res.body.board
    expect(board.plans).toHaveLength(1)
    expect(board.plans[0].pairName).toBe('Екип 1')
    expect(refs(board.plans[0])).toEqual([`check:${e1}`, `job:${jobId}`])
    plan1 = board.plans[0].id
    // The zone's board has nothing left over; the whole-day board lists the other zones' work.
    expect(board.unplanned).toEqual([])
    const whole = await request(server)
      .get(`/api/v1/day-plans?date=${tomorrow}`)
      .set(bearer(officeToken))
    expect(whole.status).toBe(200)
    expect(
      whole.body.unplanned.map((u: { kind: string; refId: string }) => `${u.kind}:${u.refId}`),
    ).toEqual([`check:${e2}`, `callback:${callbackId}`, `inspection:${inspectionId}`])
    // Labels are relative to the plan's date: due today = one day overdue tomorrow.
    expect(whole.body.unplanned[0]).toMatchObject({
      elevatorInternalNo: 'вх. Б',
      zoneId: defaultZoneId,
      label: 'проверка · просрочена с 1 ден',
    })
  })

  it('generates the whole day: overdue + due-today checks, the job goes to its technician`s pair, NN from the base', async () => {
    const res = await request(server)
      .post('/api/v1/day-plans/generate')
      .set(bearer(A.ownerToken))
      .send({ date: tomorrow })
    expect(res.status, res.text).toBe(200)
    expect(res.body).toMatchObject({ created: 1, regenerated: 1, keptLocked: 0 })
    const board = res.body.board
    expect(board.plans).toHaveLength(2)
    expect(board.unplanned).toEqual([])
    expect(board.totals).toMatchObject({ stops: 5, plans: 2, published: 0 })
    const [p1, p2] = board.plans as DayPlanDto[]
    expect(p1!.id).toBe(plan1)
    expect(p1!.pairName).toBe('Екип 1')
    // The located stop nearest to the base first, then the far one; unlocated stops last.
    expect(refs(p1!)).toEqual([`check:${e1}`, `inspection:${inspectionId}`])
    expect(p2!.pairName).toBe('Екип 2')
    expect(refs(p2!)).toEqual([`job:${jobId}`, `check:${e2}`, `callback:${callbackId}`])
    plan2 = p2!.id
    // e3's own check (due in 5 days) is nowhere.
    expect([...refs(p1!), ...refs(p2!)]).not.toContain(`check:${e3}`)
    // Display fields, labels, ETA and legs.
    const first = p1!.stops[0]!
    expect(first).toMatchObject({
      elevatorInternalNo: 'вх. А',
      customerName: 'ЕС „Младост 1“',
      contact: { name: 'Петя Димова', phone: '+359888123456' },
      status: 'planned',
      manual: false,
      lat: IN.lat,
      lng: IN.lng,
    })
    // lastCheckAt = today - 45 -> due today - 15 -> 16 days overdue on tomorrow's plan.
    expect(first.label).toBe('проверка · просрочена с 16 дни')
    expect(first.legKm).toBeGreaterThan(1)
    expect(first.legKm).toBeLessThan(2)
    expect(first.eta).toBe(sofiaLocalToUtc(tomorrow, '08:33').toISOString())
    expect(p1!.stops[1]!.eta! > first.eta!).toBe(true)
    expect(p1!.totals).toMatchObject({ stops: 2, elevators: 2, done: 0 })
    expect(p1!.totals.estKm).toBeGreaterThan(9)
    expect(p1!.start).toEqual(BASE)
    expect(p1!.userNames).toEqual(['Иван Петров'])
    expect(p2!.stops[0]!.label).toBe('Смяна на ролки')
    expect(p2!.stops[0]!.plannedAt).toBe(sofiaLocalToUtc(tomorrow, '10:00').toISOString())
    expect(p2!.stops[2]!.label).toBe('Не тръгва от партера')
    expect(p2!.stops[1]!.label).toBe('проверка · просрочена с 1 ден')
    expect(p2!.stops[1]!.legKm).toBe(0)
    // The zone-filtered board shows the zone's plan and the "every zone" plan; the day's board by date.
    const zoned = await request(server)
      .get(`/api/v1/day-plans?date=${tomorrow}&zoneId=${mladostZoneId}`)
      .set(bearer(officeToken))
    expect(zoned.status).toBe(200)
    expect(zoned.body.plans.map((p: DayPlanDto) => p.zoneId)).toEqual([mladostZoneId, null])
    const one = await request(server).get(`/api/v1/day-plans/${plan1}`).set(bearer(tech1Token))
    expect(one.status).toBe(200)
    expect(one.body.stops).toHaveLength(2)
    const audit = await prismaBase.auditLog.count({
      where: { tenantId: A.tenantId, action: 'dayPlan.generate' },
    })
    expect(audit).toBe(2)
  })

  it('PATCH reorders, adds a manual stop and validates references', async () => {
    const cur = (await request(server).get(`/api/v1/day-plans/${plan1}`).set(bearer(officeToken)))
      .body as DayPlanDto
    const bad = await request(server)
      .patch(`/api/v1/day-plans/${plan1}`)
      .set(bearer(officeToken))
      .send({ stops: [{ kind: 'check', refId: randomUUID(), elevatorId: e1, buildingId: bIn }] })
    expect(bad.status).toBe(404)
    expect(bad.body.code).toBe('dayPlan.refNotFound')
    const res = await request(server)
      .patch(`/api/v1/day-plans/${plan1}`)
      .set(bearer(officeToken))
      .send({
        notes: 'Първо Люлин заради прегледа в 9:00',
        stops: [
          { ...cur.stops[1], notes: 'прегледът е в 9:00' },
          cur.stops[0],
          { kind: 'check', refId: e3, elevatorId: e3, buildingId: bOther },
        ],
      })
    expect(res.status, res.text).toBe(200)
    const p = res.body as DayPlanDto
    expect(refs(p)).toEqual([`inspection:${inspectionId}`, `check:${e1}`, `check:${e3}`])
    expect(p.stops.map((s) => s.order)).toEqual([0, 1, 2])
    expect(p.stops[0]!.id).toBe(cur.stops[1]!.id)
    expect(p.stops[0]!.notes).toBe('прегледът е в 9:00')
    expect(p.stops[1]!.manual).toBe(false)
    expect(p.stops[2]!.manual).toBe(true)
    expect(p.stops[2]!.elevatorInternalNo).toBe('вх. В')
    expect(p.notes).toBe('Първо Люлин заради прегледа в 9:00')
    expect(p.totals.estKm).toBeGreaterThan(cur.totals.estKm)
  })

  it('moves a stop between the two pairs; the moved stop is manual in the target', async () => {
    const cur = (await request(server).get(`/api/v1/day-plans/${plan1}`).set(bearer(officeToken)))
      .body as DayPlanDto
    const stop = cur.stops.find((s) => s.kind === 'check' && s.refId === e1)!
    const other = await request(server)
      .post(`/api/v1/day-plans/${plan1}/move-stop`)
      .set(bearer(officeToken))
      .send({ stopId: randomUUID(), toPlanId: plan2 })
    expect(other.status).toBe(404)
    const res = await request(server)
      .post(`/api/v1/day-plans/${plan1}/move-stop`)
      .set(bearer(officeToken))
      .send({ stopId: stop.id, toPlanId: plan2, order: 0 })
    expect(res.status, res.text).toBe(200)
    expect(refs(res.body.from)).toEqual([`inspection:${inspectionId}`, `check:${e3}`])
    expect(refs(res.body.to)).toEqual([
      `check:${e1}`,
      `job:${jobId}`,
      `check:${e2}`,
      `callback:${callbackId}`,
    ])
    expect(res.body.to.stops[0]).toMatchObject({ id: stop.id, manual: true, order: 0 })
  })

  it('lock keeps a plan through regeneration; the other plan is regenerated around its manual stop', async () => {
    const locked = await request(server)
      .post(`/api/v1/day-plans/${plan2}/lock`)
      .set(bearer(A.ownerToken))
    expect(locked.status, locked.text).toBe(200)
    expect(locked.body.locked).toBe(true)
    expect(locked.body.lockedAt).toBeTruthy()
    const res = await request(server)
      .post('/api/v1/day-plans/generate')
      .set(bearer(A.ownerToken))
      .send({ date: tomorrow })
    expect(res.status, res.text).toBe(200)
    expect(res.body).toMatchObject({ created: 0, regenerated: 1, keptLocked: 1 })
    const [p1, p2] = res.body.board.plans as DayPlanDto[]
    // plan1: the planned inspection was replaced by the candidates in NN order (check e1 first),
    // the manual stop stayed at index 1, and the inspection came back with its old id.
    expect(refs(p1!)).toEqual([`check:${e1}`, `check:${e3}`, `inspection:${inspectionId}`])
    expect(p1!.stops[1]!.manual).toBe(true)
    expect(p1!.notes).toBe('Първо Люлин заради прегледа в 9:00')
    // plan2 untouched.
    expect(refs(p2!)).toEqual([
      `check:${e1}`,
      `job:${jobId}`,
      `check:${e2}`,
      `callback:${callbackId}`,
    ])
    expect(p2!.locked).toBe(true)
    await request(server)
      .post(`/api/v1/day-plans/${plan2}/unlock`)
      .set(bearer(A.ownerToken))
      .expect(200)
    const relocked = await request(server)
      .post(`/api/v1/day-plans/${plan2}/lock`)
      .set(bearer(A.ownerToken))
    expect(relocked.body.locked).toBe(true)
  })

  it('publish marks the plans published and emits DayPlanPublished once per plan', async () => {
    const before = await request(server)
      .get(`/api/v1/day-plans/mine?date=${tomorrow}`)
      .set(bearer(tech1Token))
    expect(before.body.items).toEqual([])
    const res = await request(server)
      .post('/api/v1/day-plans/publish')
      .set(bearer(officeToken))
      .send({ date: tomorrow })
    expect(res.status, res.text).toBe(200)
    expect(res.body.published).toBe(2)
    expect(res.body.board.totals.published).toBe(2)
    expect(res.body.board.plans.every((p: DayPlanDto) => p.status === 'published')).toBe(true)
    const again = await request(server)
      .post('/api/v1/day-plans/publish')
      .set(bearer(officeToken))
      .send({ date: tomorrow })
    expect(again.body.published).toBe(0)
    expect(
      await prismaBase.domainEvent.count({
        where: { tenantId: A.tenantId, type: 'DayPlanPublished' },
      }),
    ).toBe(2)
  })

  it('technicians pull their published plan; the phone reports a stop done; replay is idempotent', async () => {
    const mine = await request(server)
      .get(`/api/v1/day-plans/mine?date=${tomorrow}`)
      .set(appHeaders(tech1Token))
    expect(mine.status).toBe(200)
    expect(mine.body.items.map((p: DayPlanDto) => p.id)).toEqual([plan1])
    const pull = await request(server).get('/api/v1/sync/pull').set(appHeaders(tech1Token))
    expect(pull.status, pull.text).toBe(200)
    expect(pull.body.dayPlans.map((p: DayPlanDto) => p.id)).toEqual([plan1])
    const plan = pull.body.dayPlans[0] as DayPlanDto
    expect(plan.stops).toHaveLength(3)
    expect(plan.stops[0]).toMatchObject({
      kind: 'check',
      refId: e1,
      buildingAddressText: expect.stringContaining('Младост'),
      contact: { name: 'Петя Димова', phone: '+359888123456' },
    })
    expect(plan.stops[0]!.eta).toBeTruthy()
    expect(pull.body.buildings.find((b: { id: string }) => b.id === bIn).zoneId).toBe(mladostZoneId)
    const pull2 = await request(server).get('/api/v1/sync/pull').set(appHeaders(tech2Token))
    expect(pull2.body.dayPlans.map((p: DayPlanDto) => p.id)).toEqual([plan2])

    const item = {
      id: randomUUID(),
      kind: 'plan.stop',
      schemaVersion: 1,
      payload: {
        planId: plan1,
        stopId: plan.stops[0]!.id,
        status: 'done',
        at: sofiaLocalToUtc(tomorrow, '09:05').toISOString(),
        clientOffsetMs: 120,
        timestampSource: 'device',
        notes: 'Всичко наред',
      },
    }
    const push = await request(server)
      .post('/api/v1/sync/push')
      .set(appHeaders(tech1Token))
      .set('Idempotency-Key', item.id)
      .send(item)
    expect(push.status, push.text).toBe(200)
    expect(push.body.status).toBe('applied')
    const result = push.body.result as DayPlanDto
    expect(result.id).toBe(plan1)
    expect(result.stops[0]).toMatchObject({
      status: 'done',
      completedAt: item.payload.at,
      notes: 'Всичко наред',
    })
    expect(result.totals.done).toBe(1)
    const replay = await request(server)
      .post('/api/v1/sync/push')
      .set(appHeaders(tech1Token))
      .set('Idempotency-Key', item.id)
      .send(item)
    // The platform replays the stored answer verbatim and flags it in the header (as for job.event).
    expect(replay.status).toBe(200)
    expect(replay.headers['idempotency-replayed']).toBe('true')
    expect(replay.body.id).toBe(item.id)
    expect((replay.body.result as DayPlanDto).stops[0]!.completedAt).toBe(item.payload.at)
    // The office board shows it.
    const board = await request(server)
      .get(`/api/v1/day-plans?date=${tomorrow}`)
      .set(bearer(officeToken))
    const p1 = board.body.plans.find((p: DayPlanDto) => p.id === plan1) as DayPlanDto
    expect(p1.stops[0]!.status).toBe('done')
    expect(p1.totals.done).toBe(1)
    // A technician outside the pair cannot touch the plan; the office can (idempotent).
    await request(server)
      .post(`/api/v1/day-plans/${plan1}/stops/${plan.stops[0]!.id}/status`)
      .set(appHeaders(tech2Token))
      .send({ status: 'done' })
      .expect(404)
    const office = await request(server)
      .post(`/api/v1/day-plans/${plan1}/stops/${plan.stops[0]!.id}/status`)
      .set(bearer(officeToken))
      .send({ status: 'done' })
    expect(office.status).toBe(200)
    expect(office.body.totals.done).toBe(1)
    const skipped = await request(server)
      .post(`/api/v1/day-plans/${plan1}/stops/${plan.stops[1]!.id}/status`)
      .set(appHeaders(tech1Token))
      .send({ status: 'skipped', notes: 'никой не отвори' })
    expect(skipped.status).toBe(200)
    expect(skipped.body.stops[1]).toMatchObject({ status: 'skipped', notes: 'никой не отвори' })
    await request(server)
      .post(`/api/v1/day-plans/${plan1}/stops/${randomUUID()}/status`)
      .set(bearer(officeToken))
      .send({ status: 'done' })
      .expect(404)
  })

  it('closing a callback completes its stop in today`s published plan (event subscriber)', async () => {
    const gen = await request(server)
      .post('/api/v1/day-plans/generate')
      .set(bearer(A.ownerToken))
      .send({ date: today })
    expect(gen.status, gen.text).toBe(200)
    const todayPlan = (gen.body.board.plans as DayPlanDto[]).find((p) =>
      p.stops.some((s) => s.kind === 'callback'),
    )!
    expect(todayPlan).toBeTruthy()
    await request(server)
      .post('/api/v1/day-plans/publish')
      .set(bearer(A.ownerToken))
      .send({ date: today })
      .expect(200)
    const closed = await request(server)
      .post(`/api/v1/callbacks/${callbackId}/close`)
      .set(bearer(A.ownerToken))
      .send({ cause: 'блокирал контактор', actionTaken: 'почистен', createVisit: false })
    expect(closed.status, closed.text).toBe(200)
    const done = await waitFor(async () => {
      const res = await request(server)
        .get(`/api/v1/day-plans/${todayPlan.id}`)
        .set(bearer(A.ownerToken))
      const s = (res.body as DayPlanDto).stops.find((x) => x.kind === 'callback')
      return s?.status === 'done' ? s : null
    })
    expect(done.completedAt).toBeTruthy()
    // Tomorrow's callback stop is untouched (the event completes the day it happened on).
    const tomorrowPlan = (
      await request(server).get(`/api/v1/day-plans/${plan2}`).set(bearer(A.ownerToken))
    ).body as DayPlanDto
    expect(tomorrowPlan.stops.find((s) => s.kind === 'callback')!.status).toBe('planned')
    // A closed callback is no longer a candidate but the stop keeps its label.
    expect(tomorrowPlan.stops.find((s) => s.kind === 'callback')!.label).toBe(
      'Не тръгва от партера',
    )
    // The technician's pull now carries today and tomorrow.
    const pull = await request(server).get('/api/v1/sync/pull').set(appHeaders(tech1Token))
    expect(pull.body.dayPlans).toHaveLength(2)
  })
})

describe('step 9a: isolation and roles', () => {
  it('every new endpoint answers 404 for a foreign tenant', async () => {
    const b = bearer(B.ownerToken)
    await request(server).get(`/api/v1/zones/${mladostZoneId}`).set(b).expect(404)
    await request(server)
      .patch(`/api/v1/zones/${mladostZoneId}`)
      .set(b)
      .send({ name: 'x' })
      .expect(404)
    await request(server).delete(`/api/v1/zones/${mladostZoneId}`).set(b).expect(404)
    await request(server)
      .patch(`/api/v1/buildings/${bIn}`)
      .set(b)
      .send({ zoneId: mladostZoneId })
      .expect(404)
    await request(server)
      .patch(`/api/v1/technician-pairs/${pair1}`)
      .set(b)
      .send({ name: 'x' })
      .expect(404)
    await request(server).delete(`/api/v1/technician-pairs/${pair1}`).set(b).expect(404)
    await request(server).get(`/api/v1/day-plans/${plan1}`).set(b).expect(404)
    await request(server)
      .patch(`/api/v1/day-plans/${plan1}`)
      .set(b)
      .send({ notes: 'x' })
      .expect(404)
    await request(server)
      .post(`/api/v1/day-plans/${plan1}/move-stop`)
      .set(b)
      .send({ stopId: randomUUID(), toPlanId: plan2 })
      .expect(404)
    await request(server).post(`/api/v1/day-plans/${plan1}/lock`).set(b).expect(404)
    await request(server).post(`/api/v1/day-plans/${plan1}/unlock`).set(b).expect(404)
    await request(server)
      .post(`/api/v1/day-plans/${plan1}/stops/${randomUUID()}/status`)
      .set(b)
      .send({ status: 'done' })
      .expect(404)
    await request(server)
      .post('/api/v1/day-plans/publish')
      .set(b)
      .send({ date: tomorrow, planIds: [plan1] })
      .expect(404)
    const board = await request(server).get(`/api/v1/day-plans?date=${tomorrow}`).set(b)
    expect(board.body.plans).toEqual([])
    expect(board.body.unplanned.map((u: { elevatorId: string }) => u.elevatorId)).not.toContain(e1)
    const zones = await request(server).get('/api/v1/zones').set(b)
    expect(zones.body.items.map((z: { id: string }) => z.id)).not.toContain(mladostZoneId)
    expect(bElevatorId).toBeTruthy()
  })

  it('technicians get 403 on office endpoints', async () => {
    const t = bearer(tech1Token)
    await request(server).post('/api/v1/zones').set(t).send({ name: 'x' }).expect(403)
    await request(server)
      .patch(`/api/v1/zones/${mladostZoneId}`)
      .set(t)
      .send({ name: 'x' })
      .expect(403)
    await request(server).delete(`/api/v1/zones/${mladostZoneId}`).set(t).expect(403)
    await request(server).post('/api/v1/zones/recompute').set(t).expect(403)
    await request(server)
      .patch(`/api/v1/technician-pairs/${pair1}`)
      .set(t)
      .send({ name: 'x' })
      .expect(403)
    await request(server).delete(`/api/v1/technician-pairs/${pair1}`).set(t).expect(403)
    await request(server)
      .post('/api/v1/day-plans/generate')
      .set(t)
      .send({ date: tomorrow })
      .expect(403)
    await request(server)
      .post('/api/v1/day-plans/publish')
      .set(t)
      .send({ date: tomorrow })
      .expect(403)
    await request(server)
      .patch(`/api/v1/day-plans/${plan1}`)
      .set(t)
      .send({ notes: 'x' })
      .expect(403)
    await request(server)
      .post(`/api/v1/day-plans/${plan1}/move-stop`)
      .set(t)
      .send({ stopId: randomUUID(), toPlanId: plan2 })
      .expect(403)
    await request(server).post(`/api/v1/day-plans/${plan1}/lock`).set(t).expect(403)
    await request(server).post(`/api/v1/day-plans/${plan1}/unlock`).set(t).expect(403)
    // Reads stay open to everyone.
    await request(server).get('/api/v1/technician-pairs').set(t).expect(200)
    await request(server).get(`/api/v1/day-plans?date=${tomorrow}`).set(t).expect(200)
  })
})

// Keeps the type import used when the assertions above are edited.
export type { PlanStopDto }
