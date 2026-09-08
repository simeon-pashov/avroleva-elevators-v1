import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { randomUUID, createHash } from 'node:crypto'
import sharp from 'sharp'
import { disconnectDb, prismaBase } from '../../src/platform/db/prisma.js'
import { addDays, todayInSofia } from '../../src/platform/clock.js'
import { checklists } from '../../src/modules/maintenance/index.js'
import { CSRF, app, bearer, createCustomer, createTenant, resetDb, seedAdmin } from '../helpers.js'
import type { TenantFixture } from '../helpers.js'

let server: Express
let A: TenantFixture
let B: TenantFixture
let techId: string
let techUsername: string
let deviceToken: string
let deviceSessionId: string
let buildingId: string
let elevatorId: string
let hydraulicId: string
const today = todayInSofia()

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex')

async function photo(text: string, w = 2400, h = 1800): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#3b6ea5"/><text x="50%" y="50%" font-size="120" fill="#fff" text-anchor="middle">${text}</text></svg>`
  return sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer()
}

function deviceHeaders() {
  return { ...bearer(deviceToken), 'X-Client': 'app', 'X-Client-Version': '0.4.0' }
}

beforeAll(async () => {
  await resetDb()
  await seedAdmin()
  await checklists.ensureSystemTemplates()
  server = app()
  A = await createTenant(server, 'Alpha')
  B = await createTenant(server, 'Beta')
  techUsername = `tech4_${Date.now() % 100000}`
  const tech = await request(server).post('/api/v1/users').set(bearer(A.ownerToken)).send({
    username: techUsername,
    password: 'password123',
    name: 'Иван Монтьор',
    role: 'technician',
  })
  expect(tech.status).toBe(201)
  techId = tech.body.id
  const customer = await createCustomer(server, A.ownerToken, 'ЕС Алфа')
  const b = await request(server)
    .post('/api/v1/buildings')
    .set(bearer(A.ownerToken))
    .send({
      customerId: customer.id,
      address: { city: 'София', district: 'ж.к. Синхрон', block: '7', entrance: 'Б' },
      lat: 42.69,
      lng: 23.32,
    })
  buildingId = b.body.id
  await request(server)
    .post('/api/v1/contacts')
    .set(bearer(A.ownerToken))
    .send({ buildingId, name: 'Домоуправител Синхрон', phone: '0888 000 111', isPrimary: true })
  const e = await request(server)
    .post('/api/v1/elevators')
    .set(bearer(A.ownerToken))
    .send({
      buildingId,
      internalNo: 'вх. Б, ляв',
      stops: 8,
      regNo: 'СФ-4001',
      driveType: 'electric',
      doorType: 'semi_auto',
      lastCheckAt: addDays(today, -31),
      checkIntervalDays: 30,
    })
  expect(e.status, e.text).toBe(201)
  elevatorId = e.body.id
  const h = await request(server).post('/api/v1/elevators').set(bearer(A.ownerToken)).send({
    buildingId,
    internalNo: 'вх. Б, десен',
    stops: 6,
    driveType: 'hydraulic',
    doorType: 'auto',
    goodsOnly: true,
    lastCheckAt: today,
    checkIntervalDays: 30,
  })
  hydraulicId = h.body.id
})

afterAll(async () => {
  await disconnectDb()
})

describe('device enrollment and sessions', () => {
  let code: string

  it('owner creates a one-time code for a technician (QR payload = tech app URL)', async () => {
    const res = await request(server)
      .post(`/api/v1/users/${techId}/enroll-token`)
      .set(bearer(A.ownerToken))
    expect(res.status, res.text).toBe(201)
    expect(res.body.userId).toBe(techId)
    expect(res.body.token.length).toBeGreaterThanOrEqual(30)
    expect(res.body.url).toContain(`/tech/?enroll=${encodeURIComponent(res.body.token)}`)
    expect(res.body.qrSvg).toContain('<svg')
    expect(Date.parse(res.body.expiresAt) - Date.now()).toBeLessThanOrEqual(10 * 60_000)
    code = res.body.token
  })

  it('a technician cannot mint codes; a foreign owner gets 404 for our user', async () => {
    const login = await request(server)
      .post('/api/v1/auth/login')
      .set(CSRF)
      .send({ username: techUsername, password: 'password123' })
    const r = await request(server)
      .post(`/api/v1/users/${techId}/enroll-token`)
      .set(bearer(login.body.token))
    expect(r.status).toBe(403)
    const x = await request(server)
      .post(`/api/v1/users/${techId}/enroll-token`)
      .set(bearer(B.ownerToken))
    expect(x.status).toBe(404)
  })

  it('the phone exchanges the code for a device session; the code is single-use', async () => {
    const res = await request(server)
      .post('/api/v1/auth/enroll')
      .set('X-Client', 'app')
      .send({ token: code, deviceName: 'Телефон на Иван', clientVersion: '0.4.0' })
    expect(res.status, res.text).toBe(201)
    expect(res.body.user.id).toBe(techId)
    expect(res.body.tenant.id).toBe(A.tenantId)
    expect(Date.parse(res.body.expiresAt) - Date.now()).toBeGreaterThan(170 * 86_400_000)
    deviceToken = res.body.token
    deviceSessionId = res.body.sessionId
    const again = await request(server)
      .post('/api/v1/auth/enroll')
      .set('X-Client', 'app')
      .send({ token: code, deviceName: 'друг' })
    expect(again.status).toBe(401)
    expect(again.body.code).toBe('auth.enrollInvalid')
    const bogus = await request(server)
      .post('/api/v1/auth/enroll')
      .set('X-Client', 'app')
      .send({ token: 'x'.repeat(32), deviceName: 'друг' })
    expect(bogus.status).toBe(401)
  })

  it('an expired code is refused', async () => {
    const t = await request(server)
      .post(`/api/v1/users/${techId}/enroll-token`)
      .set(bearer(A.ownerToken))
    await prismaBase.deviceEnrollmentToken.updateMany({
      where: { tenantId: A.tenantId, usedAt: null },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })
    const res = await request(server)
      .post('/api/v1/auth/enroll')
      .set('X-Client', 'app')
      .send({ token: t.body.token, deviceName: 'late' })
    expect(res.status).toBe(401)
  })

  it('the device session works as Bearer without a CSRF header and sees X-Min-Client-Version', async () => {
    const me = await request(server).get('/api/v1/auth/me').set(deviceHeaders())
    expect(me.status).toBe(200)
    expect(me.body.user.role).toBe('technician')
    expect(me.headers['x-min-client-version']).toBeTruthy()
    const s = await prismaBase.session.findUnique({ where: { id: deviceSessionId } })
    expect(s?.kind).toBe('device')
    expect(s?.deviceName).toBe('Телефон на Иван')
    expect(s?.clientVersion).toBe('0.4.0')
  })

  it('the owner lists sessions (device + browser) and can revoke a phone', async () => {
    const list = await request(server).get('/api/v1/auth/sessions').set(bearer(A.ownerToken))
    expect(list.status).toBe(200)
    const dev = list.body.items.find((s: { id: string }) => s.id === deviceSessionId)
    expect(dev).toMatchObject({
      kind: 'device',
      userName: 'Иван Монтьор',
      deviceName: 'Телефон на Иван',
    })
    expect(list.body.items.some((s: { current: boolean }) => s.current)).toBe(true)
    // Foreign owner: 404 on our session id.
    const foreign = await request(server)
      .post(`/api/v1/auth/sessions/${deviceSessionId}/revoke`)
      .set(bearer(B.ownerToken))
    expect(foreign.status).toBe(404)
    // Enroll a second phone, revoke it, its token dies.
    const t = await request(server)
      .post(`/api/v1/users/${techId}/enroll-token`)
      .set(bearer(A.ownerToken))
    const second = await request(server)
      .post('/api/v1/auth/enroll')
      .set('X-Client', 'app')
      .send({ token: t.body.token, deviceName: 'Стар телефон' })
    expect(second.status).toBe(201)
    const revoke = await request(server)
      .post(`/api/v1/auth/sessions/${second.body.sessionId}/revoke`)
      .set(bearer(A.ownerToken))
    expect(revoke.status).toBe(204)
    const dead = await request(server).get('/api/v1/auth/me').set(bearer(second.body.token))
    expect(dead.status).toBe(401)
  })
})

describe('checklists', () => {
  it('GET /checklists/active filters the system template by the lift type', async () => {
    const semi = await request(server)
      .get(`/api/v1/checklists/active?elevatorId=${elevatorId}`)
      .set(deviceHeaders())
    expect(semi.status, semi.text).toBe(200)
    expect(semi.body.key).toBe('functional_check')
    expect(semi.body.tenantId).toBeNull()
    const semiCodes = semi.body.items.map((i: { code: string }) => i.code)
    expect(semiCodes).toContain('B2')
    expect(semiCodes).toContain('F5')
    expect(semiCodes).not.toContain('C1')
    expect(semiCodes).not.toContain('G1')
    expect(semiCodes).not.toContain('D1')
    const hyd = await request(server)
      .get(`/api/v1/checklists/active?elevatorId=${hydraulicId}`)
      .set(deviceHeaders())
    const hydCodes = hyd.body.items.map((i: { code: string }) => i.code)
    expect(hydCodes).toContain('G1')
    expect(hydCodes).toContain('C1')
    expect(hydCodes).toContain('D1')
    expect(hydCodes).not.toContain('F1')
    const foreign = await request(server)
      .get(`/api/v1/checklists/active?elevatorId=${elevatorId}`)
      .set(bearer(B.ownerToken))
    expect(foreign.status).toBe(404)
  })
})

describe('sync pull', () => {
  let watermark: string

  it('full pull returns the registry, templates, catalogue, jobs and the server clock', async () => {
    const res = await request(server).get('/api/v1/sync/pull').set(deviceHeaders())
    expect(res.status, res.text).toBe(200)
    expect(res.body.full).toBe(true)
    expect(Math.abs(Date.parse(res.body.serverTime) - Date.now())).toBeLessThan(5000)
    expect(res.body.me.id).toBe(techId)
    expect(res.body.tenant.settings.minTechnicians.functional_check).toBe(2)
    expect(res.body.buildings).toHaveLength(1)
    expect(res.body.buildings[0].entrance).toBe('Б')
    expect(res.body.elevators.map((e: { id: string }) => e.id).sort()).toEqual(
      [elevatorId, hydraulicId].sort(),
    )
    const ours = res.body.elevators.find((e: { id: string }) => e.id === elevatorId)
    expect(ours.dueState).toBe('overdue')
    expect(ours.goodsOnly).toBe(false)
    expect(res.body.contacts[0]).toMatchObject({
      name: 'Домоуправител Синхрон',
      phone: '+359888000111',
    })
    expect(res.body.contacts[0].email).toBeUndefined()
    expect(res.body.checklistTemplates[0].key).toBe('functional_check')
    expect(res.body.defectCatalog.length).toBeGreaterThan(10)
    expect(res.body.jobs).toContainEqual(
      expect.objectContaining({ elevatorId, state: 'overdue', daysOverdue: 1 }),
    )
    expect(res.body.users.some((u: { id: string }) => u.id === techId)).toBe(true)
    watermark = res.body.watermark
  })

  it('a delta pull returns only rows changed since the watermark, with tombstones', async () => {
    // The pull overlaps the watermark by 2 s on purpose; wait it out so the fixture rows are old.
    await new Promise((r) => setTimeout(r, 2100))
    watermark = (await request(server).get('/api/v1/sync/pull').set(deviceHeaders())).body.watermark
    await new Promise((r) => setTimeout(r, 2100))
    const contact = await request(server)
      .post('/api/v1/contacts')
      .set(bearer(A.ownerToken))
      .send({ buildingId, name: 'Касиер', phone: '0899 111 222', role: 'cashier' })
    expect(contact.status).toBe(201)
    const del = await request(server)
      .delete(`/api/v1/contacts/${contact.body.id}`)
      .set(bearer(A.ownerToken))
    expect(del.status).toBe(204)
    const res = await request(server)
      .get(`/api/v1/sync/pull?since=${encodeURIComponent(watermark)}`)
      .set(deviceHeaders())
    expect(res.status, res.text).toBe(200)
    expect(res.body.full).toBe(false)
    expect(res.body.elevators).toHaveLength(0)
    expect(res.body.buildings).toHaveLength(0)
    expect(res.body.contacts).toHaveLength(1)
    expect(res.body.contacts[0]).toMatchObject({ id: contact.body.id, name: 'Касиер' })
    expect(res.body.contacts[0].deletedAt).not.toBeNull()
    // Open work is always the full set.
    expect(res.body.jobs.length).toBeGreaterThan(0)
  })
})

describe('sync push: visit with checklist and photos, replay, defects, callbacks', () => {
  const visitId = randomUUID()
  const photoId = randomUUID()
  const logbookId = randomUUID()
  const itemId = randomUUID()
  const startedAt = new Date(Date.now() - 20 * 60_000).toISOString()

  const endedAt = new Date().toISOString()
  const createdAt = endedAt
  const item = () => ({
    id: itemId,
    kind: 'visit.record',
    schemaVersion: 1,
    createdAt,
    payload: {
      id: visitId,
      elevatorId,
      kind: 'functional_check',
      startedAt,
      endedAt,
      technicians: [{ userId: techId }],
      notes: 'Проверка от телефона.',
      source: 'app',
      timestampSource: 'device',
      clientOffsetMs: 1500,
      checklist: {
        templateKey: 'functional_check',
        templateVersion: 1,
        items: [
          { code: 'A1', result: 'ok' },
          { code: 'B2', result: 'defect', note: 'Счупена брава на 3 ет.' },
          { code: 'F5', result: 'ok' },
          { code: 'E2', result: 'na' },
        ],
      },
      attachments: [
        { id: photoId, role: 'photo' },
        { id: logbookId, role: 'logbook_page' },
      ],
    },
  })

  it('requires the Idempotency-Key header equal to the item id', async () => {
    const missing = await request(server)
      .post('/api/v1/sync/push')
      .set(deviceHeaders())
      .send(item())
    expect(missing.status).toBe(400)
    expect(missing.body.code).toBe('sync.idempotencyKeyRequired')
    const wrong = await request(server)
      .post('/api/v1/sync/push')
      .set(deviceHeaders())
      .set('Idempotency-Key', randomUUID())
      .send(item())
    expect(wrong.status).toBe(400)
    expect(wrong.body.code).toBe('sync.idempotencyKeyMismatch')
  })

  it('records the visit with a labelled checklist snapshot and pending attachment links', async () => {
    const res = await request(server)
      .post('/api/v1/sync/push')
      .set(deviceHeaders())
      .set('Idempotency-Key', itemId)
      .send(item())
    expect(res.status, res.text).toBe(200)
    expect(res.body.status).toBe('applied')
    expect(res.headers['idempotency-replayed']).toBeUndefined()
    const v = res.body.result
    expect(v.id).toBe(visitId)
    expect(v.source).toBe('app')
    expect(v.timestampSource).toBe('device')
    expect(v.clientOffsetMs).toBe(1500)
    expect(v.qualityFlags).toEqual(expect.arrayContaining(['singleTechnician', 'pendingUploads']))
    expect(v.qualityFlags).not.toContain('clockSuspect')
    expect(v.checklist.templateKey).toBe('functional_check')
    expect(v.checklist.summary).toEqual({ ok: 2, defect: 1, na: 1 })
    const b2 = v.checklist.items.find((i: { code: string }) => i.code === 'B2')
    expect(b2.label.bg).toContain('Ключалки')
    expect(b2.group).toBe('shaft_doors')
    expect(b2.note).toBe('Счупена брава на 3 ет.')
    expect(v.attachments).toEqual([
      { attachmentId: photoId, role: 'photo', uploaded: false, attachment: null },
      { attachmentId: logbookId, role: 'logbook_page', uploaded: false, attachment: null },
    ])
    // The office sees it, lastCheckAt moved.
    const e = await request(server).get(`/api/v1/elevators/${elevatorId}`).set(bearer(A.ownerToken))
    expect(e.body.lastCheckAt).toBe(today)
    expect(e.body.dueState).toBe('ok')
  })

  it('replays the same item (same body) and rejects the same key with a different body', async () => {
    const replay = await request(server)
      .post('/api/v1/sync/push')
      .set(deviceHeaders())
      .set('Idempotency-Key', itemId)
      .send(item())
    expect(replay.status).toBe(200)
    expect(replay.headers['idempotency-replayed']).toBe('true')
    expect(replay.body.result.id).toBe(visitId)
    expect(await prismaBase.visit.count({ where: { tenantId: A.tenantId, id: visitId } })).toBe(1)
    const changed = item()
    changed.payload.notes = 'друго'
    const conflict = await request(server)
      .post('/api/v1/sync/push')
      .set(deviceHeaders())
      .set('Idempotency-Key', itemId)
      .send(changed)
    expect(conflict.status).toBe(422)
    expect(conflict.body.code).toBe('sync.idempotencyMismatch')
    // A different outbox item with the same visit id is idempotent on the visit (visits.record).
    const other = { ...item(), id: randomUUID() }
    const again = await request(server)
      .post('/api/v1/sync/push')
      .set(deviceHeaders())
      .set('Idempotency-Key', other.id)
      .send(other)
    expect(again.status).toBe(200)
    expect(again.body.result.id).toBe(visitId)
    expect(await prismaBase.visit.count({ where: { tenantId: A.tenantId, id: visitId } })).toBe(1)
  })

  it('uploads the photos (hash verified, re-encoded to <= 1600 px, thumbnail) and the visit shows them', async () => {
    const bytes = await photo('снимка')
    const up = await request(server)
      .post('/api/v1/attachments')
      .set(deviceHeaders())
      .field('id', photoId)
      .field('sha256', sha256(bytes))
      .field('kind', 'photo')
      .field('takenAt', startedAt)
      .attach('file', bytes, { filename: 'p.jpg', contentType: 'image/jpeg' })
    expect(up.status, up.text).toBe(201)
    expect(up.body.id).toBe(photoId)
    expect(up.body.sha256).toBe(sha256(bytes))
    expect(up.body.width).toBe(1600)
    expect(up.body.height).toBe(1200)
    expect(up.body.mime).toBe('image/jpeg')
    expect(up.body.thumbUrl).toMatch(/^\/files\/.*v=thumb/)
    // Same id + same hash again = 200 with the stored row.
    const dup = await request(server)
      .post('/api/v1/attachments')
      .set(deviceHeaders())
      .field('id', photoId)
      .field('sha256', sha256(bytes))
      .attach('file', bytes, { filename: 'p.jpg', contentType: 'image/jpeg' })
    expect(dup.status).toBe(200)
    // Wrong hash = 400, nothing stored.
    const bad = await request(server)
      .post('/api/v1/attachments')
      .set(deviceHeaders())
      .field('id', logbookId)
      .field('sha256', 'a'.repeat(64))
      .attach('file', bytes, { filename: 'p.jpg', contentType: 'image/jpeg' })
    expect(bad.status).toBe(400)
    expect(bad.body.code).toBe('attachments.hashMismatch')
    // Not an image = 400.
    const txt = Buffer.from('not an image')
    const notImg = await request(server)
      .post('/api/v1/attachments')
      .set(deviceHeaders())
      .field('id', logbookId)
      .field('sha256', sha256(txt))
      .attach('file', txt, { filename: 'p.txt', contentType: 'text/plain' })
    expect(notImg.status).toBe(400)
    expect(notImg.body.code).toBe('attachments.notAnImage')
    // Now the logbook page.
    const page = await photo('дневник', 800, 1100)
    const up2 = await request(server)
      .post('/api/v1/attachments')
      .set(deviceHeaders())
      .field('id', logbookId)
      .field('sha256', sha256(page))
      .attach('file', page, { filename: 'l.jpg', contentType: 'image/jpeg' })
    expect(up2.status, up2.text).toBe(201)
    expect(up2.body.width).toBe(800)

    const v = await request(server).get(`/api/v1/visits/${visitId}`).set(bearer(A.ownerToken))
    expect(v.status).toBe(200)
    expect(v.body.qualityFlags).not.toContain('pendingUploads')
    expect(v.body.attachments.map((a: { uploaded: boolean }) => a.uploaded)).toEqual([true, true])
    expect(v.body.attachments[1].role).toBe('logbook_page')
    expect(v.body.attachments[0].attachment.thumbUrl).toContain(photoId)
  })

  it('serves files through signed URLs only (tenant-bound, tamper-proof)', async () => {
    const v = await request(server).get(`/api/v1/visits/${visitId}`).set(bearer(A.ownerToken))
    const thumbUrl: string = v.body.attachments[0].attachment.thumbUrl
    const fullUrl: string = v.body.attachments[0].attachment.url
    const thumb = await request(server).get(thumbUrl)
    expect(thumb.status).toBe(200)
    expect(thumb.headers['content-type']).toBe('image/jpeg')
    const meta = await sharp(thumb.body as Buffer).metadata()
    expect(meta.width).toBe(320)
    const full = await request(server).get(fullUrl)
    expect(full.status).toBe(200)
    expect((await sharp(full.body as Buffer).metadata()).width).toBe(1600)
    // Tampered signature / wrong variant / no signature -> 404.
    expect((await request(server).get(thumbUrl.replace(/sig=.{4}/, 'sig=0000'))).status).toBe(404)
    expect((await request(server).get(thumbUrl.replace('v=thumb', 'v=full'))).status).toBe(404)
    expect((await request(server).get(`/files/${photoId}`)).status).toBe(404)
    // Metadata is tenant-scoped: 404 for tenant B, 200 for our device.
    expect(
      (await request(server).get(`/api/v1/attachments/${photoId}`).set(bearer(B.ownerToken)))
        .status,
    ).toBe(404)
    expect(
      (await request(server).get(`/api/v1/attachments/${photoId}`).set(deviceHeaders())).status,
    ).toBe(200)
  })

  it('records a defect found on the checklist (sourceType visit, idempotent on id)', async () => {
    const defectId = randomUUID()
    const push = {
      id: randomUUID(),
      kind: 'defect.record',
      payload: {
        id: defectId,
        elevatorId,
        catalogCode: '4',
        severity: 'medium',
        recordedAt: startedAt,
        sourceType: 'visit',
        sourceId: visitId,
        notes: 'От чеклиста, т. B2',
        clientOffsetMs: 1500,
        timestampSource: 'device',
      },
    }
    const res = await request(server)
      .post('/api/v1/sync/push')
      .set(deviceHeaders())
      .set('Idempotency-Key', push.id)
      .send(push)
    expect(res.status, res.text).toBe(200)
    expect(res.body.result.id).toBe(defectId)
    expect(res.body.result.sourceType).toBe('visit')
    expect(res.body.result.sourceId).toBe(visitId)
    expect(res.body.result.catalogCode).toBe('4')
    expect(res.body.result.stopLift).toBe(true)
    const again = { ...push, id: randomUUID() }
    const r2 = await request(server)
      .post('/api/v1/sync/push')
      .set(deviceHeaders())
      .set('Idempotency-Key', again.id)
      .send(again)
    expect(r2.status).toBe(200)
    expect(await prismaBase.defect.count({ where: { tenantId: A.tenantId, id: defectId } })).toBe(1)
    const e = await request(server).get(`/api/v1/elevators/${elevatorId}`).set(bearer(A.ownerToken))
    expect(e.body.status).toBe('stopped_by_firm')
  })

  it('callback events from the phone carry device provenance and a clockSuspect flag when the offset is large', async () => {
    const cb = await request(server).post('/api/v1/callbacks').set(bearer(A.ownerToken)).send({
      elevatorId: hydraulicId,
      classification: 'breakdown',
      description: 'Не тръгва',
      assignedUserId: techId,
    })
    expect(cb.status, cb.text).toBe(201)
    const pull = await request(server).get('/api/v1/sync/pull').set(deviceHeaders())
    expect(pull.body.callbacks.map((c: { id: string }) => c.id)).toContain(cb.body.id)
    const push = {
      id: randomUUID(),
      kind: 'callback.event',
      payload: {
        callbackId: cb.body.id,
        type: 'on_site',
        at: new Date().toISOString(),
        clientOffsetMs: 4 * 60_000,
        timestampSource: 'device',
        notes: 'Пристигнах',
      },
    }
    const res = await request(server)
      .post('/api/v1/sync/push')
      .set(deviceHeaders())
      .set('Idempotency-Key', push.id)
      .send(push)
    expect(res.status, res.text).toBe(200)
    expect(res.body.result.status).toBe('on_site')
    expect(res.body.result.responseMinutes).toBe(0)
    const detail = await request(server)
      .get(`/api/v1/callbacks/${cb.body.id}`)
      .set(bearer(A.ownerToken))
    const ev = detail.body.events.find((x: { type: string }) => x.type === 'on_site')
    expect(ev.source).toBe('app')
    expect(ev.data).toMatchObject({
      notes: 'Пристигнах',
      timestampSource: 'device',
      clientOffsetMs: 240_000,
      qualityFlags: ['clockSuspect'],
    })
    // Invalid transition is a permanent 409 (the phone marks the item failed, keeps draining).
    const bad = { ...push, id: randomUUID(), payload: { ...push.payload, type: 'on_site' } }
    const r = await request(server)
      .post('/api/v1/sync/push')
      .set(deviceHeaders())
      .set('Idempotency-Key', bad.id)
      .send(bad)
    expect(r.status).toBe(409)
    // A closed callback arrives as a tombstone on the next delta pull.
    const close = await request(server)
      .post(`/api/v1/callbacks/${cb.body.id}/close`)
      .set(bearer(A.ownerToken))
      .send({ cause: 'Предпазител', actionTaken: 'Сменен', chargeable: false, createVisit: false })
    expect(close.status).toBe(200)
    const delta = await request(server)
      .get(`/api/v1/sync/pull?since=${encodeURIComponent(pull.body.watermark)}`)
      .set(deviceHeaders())
    const gone = delta.body.callbacks.find((c: { id: string }) => c.id === cb.body.id)
    expect(gone.status).toBe('closed')
  })

  it('the pull returns the recorded visit with attachments; the office print page renders the logbook entry', async () => {
    const pull = await request(server).get('/api/v1/sync/pull').set(deviceHeaders())
    const v = pull.body.visits.find((x: { id: string }) => x.id === visitId)
    expect(v).toBeTruthy()
    expect(v.attachments).toHaveLength(2)
    expect(v.checklist.items.length).toBe(4)
    const page = await request(server).get(`/print/logbook/${visitId}`).set(deviceHeaders())
    expect(page.status).toBe(200)
    expect(page.text).toContain('Запис за дневника')
    expect(page.text).toContain('Ключалки')
    expect(page.text).toContain('Счупена брава')
    expect(page.text).not.toContain('Люк на покрива') // n/a items are omitted
    expect(page.text).toContain('Иван Монтьор')
    expect(page.text).toContain(`/files/${photoId}?v=thumb`)
    const office = await request(server).get(`/print/logbook/${visitId}`).set(bearer(A.ownerToken))
    expect(office.status).toBe(200)
    const foreign = await request(server).get(`/print/logbook/${visitId}`).set(bearer(B.ownerToken))
    expect(foreign.status).toBe(404)
  })

  it('office history lists the app visit with photos and the checklist summary', async () => {
    const hist = await request(server)
      .get(`/api/v1/elevators/${elevatorId}/visits`)
      .set(bearer(A.ownerToken))
    const v = hist.body.items.find((x: { id: string }) => x.id === visitId)
    expect(v.source).toBe('app')
    expect(v.attachments.filter((a: { uploaded: boolean }) => a.uploaded)).toHaveLength(2)
    expect(v.checklist.summary.defect).toBe(1)
  })
})

describe('tenant isolation for step 4', () => {
  it('foreign tenant gets 404 on our visit, attachment, checklist and session routes; a foreign device cannot push to our lift', async () => {
    const b = bearer(B.ownerToken)
    const anyVisit = await prismaBase.visit.findFirst({ where: { tenantId: A.tenantId } })
    expect((await request(server).get(`/api/v1/visits/${anyVisit!.id}`).set(b)).status).toBe(404)
    const push = {
      id: randomUUID(),
      kind: 'visit.record',
      payload: {
        id: randomUUID(),
        elevatorId,
        startedAt: new Date().toISOString(),
        technicians: [{ name: 'X' }],
        source: 'app',
        timestampSource: 'device',
      },
    }
    const r = await request(server)
      .post('/api/v1/sync/push')
      .set(b)
      .set('Idempotency-Key', push.id)
      .send(push)
    expect(r.status).toBe(404)
    // Idempotency keys are per tenant: the same key from tenant A is not a replay for B and vice versa.
    const pullB = await request(server).get('/api/v1/sync/pull').set(b)
    expect(pullB.status).toBe(200)
    expect(pullB.body.elevators).toHaveLength(0)
    expect(pullB.body.visits).toHaveLength(0)
  })
})
