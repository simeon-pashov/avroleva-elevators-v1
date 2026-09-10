import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { disconnectDb } from '../../src/platform/db/prisma.js'
import { apkPath, APK_MIME } from '../../src/http/downloads.js'
import { app, bearer, createTenant, resetDb, seedAdmin } from '../helpers.js'
import type { TenantFixture } from '../helpers.js'

/**
 * Step 10 - native Android shell: CORS for the Capacitor WebView origin, bearer-only device
 * sessions (no cookie anywhere), the sideloading page and the APK download.
 */
let server: Express
let A: TenantFixture
let techId: string
let deviceToken: string

const APP_ORIGIN = 'https://localhost'

beforeAll(async () => {
  await resetDb()
  await seedAdmin()
  server = app()
  A = await createTenant(server, 'Alpha')
  const tech = await request(server)
    .post('/api/v1/users')
    .set(bearer(A.ownerToken))
    .send({
      username: `tech10_${Date.now() % 100000}`,
      password: 'password123',
      name: 'Иван Монтьор',
      role: 'technician',
    })
  expect(tech.status).toBe(201)
  techId = tech.body.id
})

afterAll(async () => {
  rmSync(apkPath(), { force: true })
  await disconnectDb()
})

describe('CORS for the native app origin', () => {
  it('answers the preflight for the app origin without auth', async () => {
    const res = await request(server)
      .options('/api/v1/sync/pull')
      .set('Origin', APP_ORIGIN)
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'authorization, x-client, x-client-version')
    expect(res.status).toBe(204)
    expect(res.headers['access-control-allow-origin']).toBe(APP_ORIGIN)
    expect(res.headers['access-control-allow-credentials']).toBe('true')
    expect(res.headers['access-control-allow-headers']).toContain('authorization')
    expect(res.headers['access-control-allow-methods']).toContain('POST')
    expect(res.headers['vary']).toContain('Origin')
  })

  it('allows capacitor://localhost too and refuses a foreign origin', async () => {
    const cap = await request(server)
      .options('/api/v1/health')
      .set('Origin', 'capacitor://localhost')
    expect(cap.status).toBe(204)
    expect(cap.headers['access-control-allow-origin']).toBe('capacitor://localhost')
    const foreign = await request(server)
      .get('/api/v1/health')
      .set('Origin', 'https://evil.example')
    expect(foreign.status).toBe(200)
    expect(foreign.headers['access-control-allow-origin']).toBeUndefined()
    const preflight = await request(server)
      .options('/api/v1/health')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'GET')
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined()
  })
})

describe('bearer-only device session from the app origin', () => {
  it('enrolls with the custom header and no cookie; the response carries the token', async () => {
    const mint = await request(server)
      .post(`/api/v1/users/${techId}/enroll-token`)
      .set(bearer(A.ownerToken))
    expect(mint.status).toBe(201)
    // The QR/link carries the origin the app derives the server from.
    expect(mint.body.url).toMatch(/^https?:\/\/[^/]+.*\/tech\/\?enroll=/)
    const res = await request(server)
      .post('/api/v1/auth/enroll')
      .set('Origin', APP_ORIGIN)
      .set('X-Client', 'app')
      .set('X-Client-Version', '0.6.0')
      .send({ token: mint.body.token, deviceName: 'Android – Иван', clientVersion: '0.6.0' })
    expect(res.status, res.text).toBe(201)
    deviceToken = res.body.token
    expect(res.headers['access-control-allow-origin']).toBe(APP_ORIGIN)
    expect(String(res.headers['access-control-expose-headers']).toLowerCase()).toContain(
      'x-min-client-version',
    )
    expect(res.headers['set-cookie']).toBeUndefined()
  })

  it('pulls and pushes with the bearer token only (no cookie, no CSRF header)', async () => {
    const pull = await request(server)
      .get('/api/v1/sync/pull')
      .set('Origin', APP_ORIGIN)
      .set(bearer(deviceToken))
      .set('X-Client', 'app')
      .set('X-Client-Version', '0.6.0')
    expect(pull.status, pull.text).toBe(200)
    expect(pull.body.tenant.id).toBe(A.tenantId)
    expect(pull.headers['access-control-allow-origin']).toBe(APP_ORIGIN)
    expect(pull.headers['x-min-client-version']).toBeDefined()
    const push = await request(server)
      .post('/api/v1/sync/push')
      .set('Origin', APP_ORIGIN)
      .set(bearer(deviceToken))
      .set('X-Client', 'app')
      .set('X-Client-Version', '0.6.0')
      .set('Idempotency-Key', '01900000-0000-7000-8000-000000000001')
      .send({ items: [] })
    expect(push.status, push.text).toBeLessThan(500)
    expect(push.status).not.toBe(401)
    expect(push.status).not.toBe(403)
    // Without the token the app origin gets a clean 401 (the app asks for re-enrollment).
    const anon = await request(server).get('/api/v1/sync/pull').set('Origin', APP_ORIGIN)
    expect(anon.status).toBe(401)
  })

  it('the device session shows up as a device session for the office', async () => {
    const sessions = await request(server).get('/api/v1/auth/sessions').set(bearer(A.ownerToken))
    expect(sessions.status).toBe(200)
    const items = (sessions.body.items ?? sessions.body) as Array<{
      kind: string
      deviceName?: string | null
    }>
    expect(items.some((s) => s.kind === 'device' && s.deviceName === 'Android – Иван')).toBe(true)
  })
})

describe('sideloading page and APK download', () => {
  it('serves the Bulgarian page with the QR even without an APK, and 404 for the file', async () => {
    rmSync(apkPath(), { force: true })
    const pg = await request(server).get('/downloads/')
    expect(pg.status).toBe(200)
    expect(pg.headers['content-type']).toContain('text/html')
    expect(pg.text).toContain('<svg')
    expect(pg.text).toContain('/downloads/tech.apk')
    expect(pg.text).toContain('Все още няма качено приложение')
    const noSlash = await request(server).get('/downloads')
    expect(noSlash.status).toBe(200)
    const apk = await request(server).get('/downloads/tech.apk')
    expect(apk.status).toBe(404)
  })

  it('streams DATA_DIR/releases/tech.apk with the Android MIME type when present', async () => {
    const p = apkPath()
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, Buffer.from('PKfake-apk-for-test'))
    const apk = await request(server).get('/downloads/tech.apk')
    expect(apk.status).toBe(200)
    expect(apk.headers['content-type']).toContain(APK_MIME)
    expect(apk.headers['content-disposition']).toContain('tech.apk')
    expect(Number(apk.headers['content-length'])).toBeGreaterThan(10)
    const pg = await request(server).get('/downloads/')
    expect(pg.text).toContain('качен на')
    expect(pg.text).not.toContain('Все още няма качено приложение')
  })
})
