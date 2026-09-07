import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { IMPORT_COLUMNS } from '@avroleva/contracts'
import { disconnectDb } from '../../src/platform/db/prisma.js'
import {
  ADMIN,
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

beforeAll(async () => {
  await resetDb()
  await seedAdmin()
  server = app()
  A = await createTenant(server, 'Alpha')
  B = await createTenant(server, 'Beta')
})

afterAll(async () => {
  await disconnectDb()
})

describe('health', () => {
  it('reports db up', async () => {
    const res = await request(server).get('/api/v1/health')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ ok: true, db: 'up' })
    expect(res.headers['x-request-id']).toBeTruthy()
  })
})

describe('auth', () => {
  it('logs in with username/password, sets an httpOnly cookie and returns a bearer token', async () => {
    const res = await request(server).post('/api/v1/auth/login').set(CSRF).send(A.owner)
    expect(res.status).toBe(200)
    expect(res.body.user.role).toBe('owner')
    expect(res.body.locale).toBe('bg')
    const cookie = res.headers['set-cookie']?.[0] ?? ''
    expect(cookie).toContain('avroleva_session=')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Path=/')
    // cookie path
    const me = await request(server)
      .get('/api/v1/auth/me')
      .set('Cookie', cookie.split(';')[0]!)
      .set(CSRF)
    expect(me.status).toBe(200)
    expect(me.body.tenant.id).toBe(A.tenantId)
    // bearer path (same session token)
    const meB = await request(server).get('/api/v1/auth/me').set(bearer(res.body.token))
    expect(meB.status).toBe(200)
  })

  it('rejects a cookie request without the CSRF header, and a mutating request without it', async () => {
    const res = await request(server).post('/api/v1/auth/login').set(CSRF).send(A.owner)
    const cookie = (res.headers['set-cookie']?.[0] ?? '').split(';')[0]!
    const noHeader = await request(server).get('/api/v1/auth/me').set('Cookie', cookie)
    expect(noHeader.status).toBe(403)
    expect(noHeader.body.code).toBe('auth.csrf')
    const login = await request(server).post('/api/v1/auth/login').send(A.owner)
    expect(login.status).toBe(403)
  })

  it('rejects wrong password and unknown user with the same 401 problem', async () => {
    const bad = await request(server)
      .post('/api/v1/auth/login')
      .set(CSRF)
      .send({ username: A.owner.username, password: 'wrongwrong' })
    expect(bad.status).toBe(401)
    expect(bad.headers['content-type']).toContain('application/problem+json')
    expect(bad.body.code).toBe('auth.invalidCredentials')
    expect(bad.body.title).not.toBe('auth.invalidCredentials') // resolved in bg
    const unknown = await request(server)
      .post('/api/v1/auth/login')
      .set(CSRF)
      .send({ username: 'nobody99', password: 'wrongwrong' })
    expect(unknown.status).toBe(401)
    expect(unknown.body.code).toBe('auth.invalidCredentials')
  })

  it('validation errors are RFC 7807 with translated field messages', async () => {
    const res = await request(server).post('/api/v1/auth/login').set(CSRF).send({ username: 'x' })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('error.validation')
    expect(res.body.fields.length).toBeGreaterThan(0)
    expect(res.body.fields[0].message).toBeTruthy()
  })

  it('logout revokes the session', async () => {
    const res = await request(server).post('/api/v1/auth/login').set(CSRF).send(A.owner)
    const token = res.body.token as string
    await request(server).post('/api/v1/auth/logout').set(bearer(token)).expect(204)
    await request(server).get('/api/v1/auth/me').set(bearer(token)).expect(401)
  })

  it('english locale resolves from the user setting', async () => {
    const res = await request(server)
      .patch('/api/v1/auth/me')
      .set(bearer(A.ownerToken))
      .send({ locale: 'en' })
    expect(res.status).toBe(200)
    expect(res.body.locale).toBe('en')
    const bad = await request(server).post('/api/v1/buildings').set(bearer(A.ownerToken)).send({})
    expect(bad.status).toBe(400)
    expect(bad.body.title).toBe('Validation failed')
    await request(server).patch('/api/v1/auth/me').set(bearer(A.ownerToken)).send({ locale: 'bg' })
  })
})

describe('users & roles', () => {
  it('owner creates users; technician cannot write the registry; deactivated user cannot log in', async () => {
    const tech = {
      username: `tech_${Date.now() % 100000}`,
      password: 'techpass1',
      name: 'Техник',
      role: 'technician',
    }
    const created = await request(server).post('/api/v1/users').set(bearer(A.ownerToken)).send(tech)
    expect(created.status).toBe(201)
    const login = await request(server)
      .post('/api/v1/auth/login')
      .set(CSRF)
      .send({ username: tech.username, password: tech.password })
    expect(login.status).toBe(200)
    const techToken = login.body.token as string
    await request(server).get('/api/v1/buildings').set(bearer(techToken)).expect(200)
    const forbidden = await request(server)
      .post('/api/v1/buildings')
      .set(bearer(techToken))
      .send({ address: { city: 'София' } })
    expect(forbidden.status).toBe(403)
    await request(server).get('/api/v1/users').set(bearer(techToken)).expect(403)
    await request(server)
      .patch(`/api/v1/users/${created.body.id}`)
      .set(bearer(A.ownerToken))
      .send({ isActive: false })
      .expect(200)
    await request(server).get('/api/v1/auth/me').set(bearer(techToken)).expect(401)
    const again = await request(server)
      .post('/api/v1/auth/login')
      .set(CSRF)
      .send({ username: tech.username, password: tech.password })
    expect(again.status).toBe(401)
  })

  it('username must be globally unique and the last owner cannot be demoted', async () => {
    const dup = await request(server)
      .post('/api/v1/users')
      .set(bearer(A.ownerToken))
      .send({ username: B.owner.username, password: 'password123', name: 'X', role: 'office' })
    expect(dup.status).toBe(409)
    const me = await request(server).get('/api/v1/auth/me').set(bearer(A.ownerToken))
    const demote = await request(server)
      .patch(`/api/v1/users/${me.body.user.id}`)
      .set(bearer(A.ownerToken))
      .send({ role: 'office' })
    expect(demote.status).toBe(409)
    expect(demote.body.code).toBe('users.lastOwner')
  })
})

describe('registry CRUD', () => {
  it('customer -> building -> elevator -> contract -> terminate', async () => {
    const customer = await createCustomer(server, A.ownerToken, 'ЕС „Тест 1“')
    const b = await request(server)
      .post('/api/v1/buildings')
      .set(bearer(A.ownerToken))
      .send({
        customerId: customer.id,
        address: { city: 'София', district: 'ж.к. Люлин 5', block: '512', entrance: 'В' },
        accessNotes: 'код 1234',
      })
    expect(b.status).toBe(201)
    expect(b.body.addressText).toBe('София, ж.к. Люлин 5, бл. 512, вх. В')
    expect(b.body.geocodeStatus).toBe('pending')

    const e = await request(server).post('/api/v1/elevators').set(bearer(A.ownerToken)).send({
      buildingId: b.body.id,
      internalNo: 'вх. В, ляв',
      stops: 8,
      regNo: 'СФ 3120',
      lastCheckAt: '2026-08-20',
      checkIntervalDays: 15,
    })
    expect(e.status).toBe(201)
    expect(e.body.effectiveIntervalDays).toBe(15)
    expect(e.body.nextCheckDue).toBe('2026-09-04')
    expect(e.body.publicCode).toHaveLength(8)

    const e2 = await request(server)
      .post('/api/v1/elevators')
      .set(bearer(A.ownerToken))
      .send({ buildingId: b.body.id, internalNo: 'вх. В, десен', stops: 8 })
    expect(e2.body.effectiveIntervalDays).toBe(30)
    expect(e2.body.nextCheckDue).toBeNull()

    const detail = await request(server)
      .get(`/api/v1/buildings/${b.body.id}`)
      .set(bearer(A.ownerToken))
    expect(detail.status).toBe(200)
    expect(detail.body.elevators).toHaveLength(2)
    expect(detail.body.customerName).toBe('ЕС „Тест 1“')

    const c = await request(server)
      .post('/api/v1/contracts')
      .set(bearer(A.ownerToken))
      .send({
        customerId: customer.id,
        buildingId: b.body.id,
        startDate: '2026-01-01',
        paymentDay: 10,
        lines: [
          { elevatorId: e.body.id, monthlyPriceCents: 5500 },
          { elevatorId: e2.body.id, monthlyPriceCents: 4500 },
        ],
      })
    expect(c.status).toBe(201)
    expect(c.body.monthlyTotalCents).toBe(10000)
    expect(c.body.lines[0].elevatorInternalNo).toBeTruthy()

    const term = await request(server)
      .post(`/api/v1/contracts/${c.body.id}/terminate`)
      .set(bearer(A.ownerToken))
      .send({ endDate: '2026-09-30', reason: 'смяна на фирма' })
    expect(term.status).toBe(200)
    expect(term.body.status).toBe('terminated')
    const eAfter = await request(server)
      .get(`/api/v1/elevators/${e.body.id}`)
      .set(bearer(A.ownerToken))
    expect(eAfter.body.status).toBe('out_of_contract')

    // settings change the effective interval
    await request(server)
      .patch('/api/v1/tenant')
      .set(bearer(A.ownerToken))
      .send({ settings: { checkIntervalDays: 20 } })
      .expect(200)
    const e2After = await request(server)
      .get(`/api/v1/elevators/${e2.body.id}`)
      .set(bearer(A.ownerToken))
    expect(e2After.body.effectiveIntervalDays).toBe(20)
    await request(server)
      .patch('/api/v1/tenant')
      .set(bearer(A.ownerToken))
      .send({ settings: { checkIntervalDays: 30 } })
  })

  it('cursor pagination walks the whole list without duplicates', async () => {
    const building = await createBuilding(server, A.ownerToken, 'ж.к. Дружба 1', '45')
    for (let i = 0; i < 5; i++) await createElevator(server, A.ownerToken, building.id, `лифт ${i}`)
    const seen = new Set<string>()
    let cursor: string | null = null
    do {
      const res = await request(server)
        .get('/api/v1/elevators')
        .query({ buildingId: building.id, limit: 2, ...(cursor ? { cursor } : {}) })
        .set(bearer(A.ownerToken))
      expect(res.status).toBe(200)
      for (const it of res.body.items) {
        expect(seen.has(it.id)).toBe(false)
        seen.add(it.id)
      }
      cursor = res.body.nextCursor
    } while (cursor)
    expect(seen.size).toBe(5)
  })

  it('geocodes a building through the Geocoder port (stub in tests) and accepts a manual pin', async () => {
    const building = await createBuilding(server, A.ownerToken, 'ж.к. Надежда 2', '235')
    const geo = await request(server)
      .post(`/api/v1/buildings/${building.id}/geocode`)
      .set(bearer(A.ownerToken))
    expect(geo.status).toBe(200)
    expect(geo.body.status).toBe('ok')
    expect(geo.body.provider).toBe('stub')
    const pin = await request(server)
      .put(`/api/v1/buildings/${building.id}/location`)
      .set(bearer(A.ownerToken))
      .send({ lat: 42.7, lng: 23.3 })
    expect(pin.status).toBe(200)
    expect(pin.body.geocodeStatus).toBe('manual')
    const pins = await request(server).get('/api/v1/buildings/pins').set(bearer(A.ownerToken))
    expect(pins.body.items.some((p: { id: string }) => p.id === building.id)).toBe(true)
  })

  it('archives instead of deleting, and refuses to archive a building with elevators', async () => {
    const building = await createBuilding(server, A.ownerToken, 'ж.к. Гео Милев', '7')
    await createElevator(server, A.ownerToken, building.id)
    const refuse = await request(server)
      .delete(`/api/v1/buildings/${building.id}`)
      .set(bearer(A.ownerToken))
    expect(refuse.status).toBe(409)
    const customer = await createCustomer(server, A.ownerToken, 'За архив')
    await request(server)
      .delete(`/api/v1/customers/${customer.id}`)
      .set(bearer(A.ownerToken))
      .expect(204)
    await request(server)
      .get(`/api/v1/customers/${customer.id}`)
      .set(bearer(A.ownerToken))
      .expect(404)
  })
})

describe('CSV import', () => {
  it('preview -> commit creates customers, buildings, elevators, contacts and contracts', async () => {
    const header = IMPORT_COLUMNS.join(';')
    const row = (internal: string, entrance: string, price: string) =>
      [
        'ЕС „Импорт бл. 9“',
        'етажна собственост',
        'Домоуправител Импорт',
        '0888 999 111',
        'да',
        '',
        'София',
        'София-град',
        'ж.к. Импорт',
        '',
        '9',
        entrance,
        internal,
        '',
        '',
        'Schindler',
        '1980',
        'електрически',
        'ръчни',
        '8',
        '320',
        price,
        '01.01.2026',
        '20.08.2026',
        '',
        '',
        '',
        '',
        '',
        '',
      ].join(';')
    const csv = [
      header,
      row('ляв', 'А', '50'),
      row('десен', 'А', '50,5'),
      row('единствен', 'Б', ''),
    ].join('\n')
    const preview = await request(server)
      .post('/api/v1/imports/preview')
      .set(bearer(A.ownerToken))
      .send({ filename: 'test.csv', csv })
    expect(preview.status).toBe(201)
    expect(preview.body.rowCount).toBe(3)
    expect(preview.body.errorCount).toBe(0)
    expect(preview.body.warningCount).toBeGreaterThan(0) // missing reg numbers
    const commit = await request(server)
      .post(`/api/v1/imports/${preview.body.id}/commit`)
      .set(bearer(A.ownerToken))
    expect(commit.status).toBe(200)
    expect(commit.body.status).toBe('committed')
    expect(commit.body.created).toMatchObject({
      customers: 1,
      buildings: 2,
      elevators: 3,
      contacts: 2,
      contracts: 1,
    })
    const again = await request(server)
      .post(`/api/v1/imports/${preview.body.id}/commit`)
      .set(bearer(A.ownerToken))
    expect(again.status).toBe(409)
    const contracts = await request(server)
      .get('/api/v1/contracts')
      .query({ q: 'Импорт' })
      .set(bearer(A.ownerToken))
    expect(contracts.body.items[0].monthlyTotalCents).toBe(10050)
  })

  it('refuses to commit a preview with errors', async () => {
    const csv = ['Град;Асансьор №;Спирки', ';ляв;8'].join('\n')
    const preview = await request(server)
      .post('/api/v1/imports/preview')
      .set(bearer(A.ownerToken))
      .send({ csv })
    expect(preview.body.errorCount).toBeGreaterThan(0)
    const commit = await request(server)
      .post(`/api/v1/imports/${preview.body.id}/commit`)
      .set(bearer(A.ownerToken))
    expect(commit.status).toBe(409)
    expect(commit.body.code).toBe('import.hasErrors')
  })

  it('serves the template with a BOM and Bulgarian headers', async () => {
    const res = await request(server).get('/api/v1/imports/template.csv').set(bearer(A.ownerToken))
    expect(res.status).toBe(200)
    expect(res.text.charCodeAt(0)).toBe(0xfeff)
    expect(res.text).toContain('Ползвател;Тип ползвател')
  })
})

describe('tenant isolation (two tenants, cross access -> 404)', () => {
  it('B cannot read, update, delete or attach to A records; lists never leak', async () => {
    const customer = await createCustomer(server, A.ownerToken, 'Само А')
    const building = await createBuilding(server, A.ownerToken, 'ж.к. Изолация', '1')
    const elevator = await createElevator(server, A.ownerToken, building.id)
    const contract = await request(server)
      .post('/api/v1/contracts')
      .set(bearer(A.ownerToken))
      .send({
        customerId: customer.id,
        buildingId: building.id,
        startDate: '2026-01-01',
        lines: [{ elevatorId: elevator.id, monthlyPriceCents: 100 }],
      })
    expect(contract.status).toBe(201)
    const contact = await request(server)
      .post('/api/v1/contacts')
      .set(bearer(A.ownerToken))
      .send({ buildingId: building.id, name: 'Контакт А', phone: '0888000000' })
    expect(contact.status).toBe(201)

    const b = bearer(B.ownerToken)
    const paths = [
      `/api/v1/customers/${customer.id}`,
      `/api/v1/buildings/${building.id}`,
      `/api/v1/elevators/${elevator.id}`,
      `/api/v1/contracts/${contract.body.id}`,
    ]
    for (const p of paths) {
      expect((await request(server).get(p).set(b)).status, `GET ${p}`).toBe(404)
      expect(
        (await request(server).patch(p).set(b).send({ notes: 'x' })).status,
        `PATCH ${p}`,
      ).toBe(404)
      expect((await request(server).delete(p).set(b)).status, `DELETE ${p}`).toBe(404)
    }
    expect(
      (
        await request(server)
          .patch(`/api/v1/contacts/${contact.body.id}`)
          .set(b)
          .send({ name: 'Y' })
      ).status,
    ).toBe(404)
    expect(
      (await request(server).post(`/api/v1/buildings/${building.id}/geocode`).set(b)).status,
    ).toBe(404)
    expect(
      (
        await request(server)
          .post(`/api/v1/contracts/${contract.body.id}/terminate`)
          .set(b)
          .send({ endDate: '2026-12-31' })
      ).status,
    ).toBe(404)
    // attaching a child to A's parent is also a 404
    expect(
      (
        await request(server)
          .post('/api/v1/elevators')
          .set(b)
          .send({ buildingId: building.id, internalNo: 'x', stops: 4 })
      ).status,
    ).toBe(404)
    expect(
      (
        await request(server)
          .post('/api/v1/contacts')
          .set(b)
          .send({ buildingId: building.id, name: 'Нахалник' })
      ).status,
    ).toBe(404)
    expect(
      (
        await request(server)
          .post('/api/v1/contracts')
          .set(b)
          .send({
            customerId: customer.id,
            buildingId: building.id,
            startDate: '2026-01-01',
            lines: [{ elevatorId: elevator.id, monthlyPriceCents: 1 }],
          })
      ).status,
    ).toBe(404)

    for (const list of [
      '/api/v1/customers',
      '/api/v1/buildings',
      '/api/v1/elevators',
      '/api/v1/contracts',
      '/api/v1/contacts',
      '/api/v1/buildings/pins',
    ]) {
      const res = await request(server).get(list).query({ limit: 200 }).set(b)
      expect(res.status).toBe(200)
      expect(res.body.items).toEqual([])
    }
    const usersB = await request(server).get('/api/v1/users').set(b)
    expect(usersB.body.items.every((u: { tenantId: string }) => u.tenantId === B.tenantId)).toBe(
      true,
    )
  })

  it('a non-uuid id is a plain 404', async () => {
    await request(server).get('/api/v1/buildings/not-an-id').set(bearer(A.ownerToken)).expect(404)
  })
})

describe('platform admin', () => {
  it('lists tenants with counts, deactivates/reactivates, resets a password', async () => {
    const token = await adminToken(server)
    const list = await request(server).get('/api/v1/admin/tenants').set(bearer(token))
    expect(list.status).toBe(200)
    const a = list.body.items.find((t: { id: string }) => t.id === A.tenantId)
    expect(a.counts.elevators).toBeGreaterThan(0)
    expect(a.counts.users).toBeGreaterThan(0)

    const closed = await request(server)
      .patch(`/api/v1/admin/tenants/${B.tenantId}`)
      .set(bearer(token))
      .send({ status: 'closed' })
    expect(closed.body.status).toBe('closed')
    const login = await request(server).post('/api/v1/auth/login').set(CSRF).send(B.owner)
    expect(login.status).toBe(401)
    await request(server)
      .patch(`/api/v1/admin/tenants/${B.tenantId}`)
      .set(bearer(token))
      .send({ status: 'active' })
      .expect(200)

    const detail = await request(server)
      .get(`/api/v1/admin/tenants/${B.tenantId}`)
      .set(bearer(token))
    const ownerId = detail.body.users[0].id as string
    await request(server)
      .post(`/api/v1/admin/tenants/${B.tenantId}/users/${ownerId}/password`)
      .set(bearer(token))
      .send({ password: 'newpass123' })
      .expect(204)
    expect((await request(server).post('/api/v1/auth/login').set(CSRF).send(B.owner)).status).toBe(
      401,
    )
    const ok = await request(server)
      .post('/api/v1/auth/login')
      .set(CSRF)
      .send({ username: B.owner.username, password: 'newpass123' })
    expect(ok.status).toBe(200)
    B.ownerToken = ok.body.token
    B.owner.password = 'newpass123'
  })

  it('admin endpoints are closed to tenant users and to anonymous callers', async () => {
    await request(server).get('/api/v1/admin/tenants').set(bearer(A.ownerToken)).expect(401)
    await request(server).get('/api/v1/admin/tenants').expect(401)
    const bad = await request(server)
      .post('/api/v1/admin/auth/login')
      .set(CSRF)
      .send({ username: ADMIN.username, password: 'nope-nope' })
    expect(bad.status).toBe(401)
  })
})
