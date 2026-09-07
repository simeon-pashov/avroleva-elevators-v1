import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { disconnectDb, prismaBase } from '../../src/platform/db/prisma.js'
import { hashToken } from '../../src/modules/tenancy/domain/session.js'
import { CSRF, app, bearer, createTenant, resetDb, seedAdmin } from '../helpers.js'
import type { TenantFixture } from '../helpers.js'

let server: Express
let A: TenantFixture

beforeAll(async () => {
  await resetDb()
  await seedAdmin()
  server = app()
  A = await createTenant(server, 'Concurrent')
})

afterAll(async () => {
  await disconnectDb()
})

/** Ages the session so that every following request takes the sliding-expiry write path. */
async function ageSession(token: string) {
  await prismaBase.session.update({
    where: { tokenHash: hashToken(token) },
    data: { lastSeenAt: new Date(Date.now() - 3 * 60 * 60 * 1000) },
  })
}

describe('session renewal under concurrency (the full-page-reload burst)', () => {
  it('30 parallel GET /auth/me on one aged session all succeed', async () => {
    await ageSession(A.ownerToken)
    const results = await Promise.all(
      Array.from({ length: 30 }, () =>
        request(server).get('/api/v1/auth/me').set(bearer(A.ownerToken)),
      ),
    )
    expect(results.map((r) => r.status)).toEqual(Array(30).fill(200))
    const s = await prismaBase.session.findUnique({ where: { tokenHash: hashToken(A.ownerToken) } })
    expect(Date.now() - s!.lastSeenAt.getTime()).toBeLessThan(60_000)
  })

  it('parallel cookie + bearer requests with mixed reads and writes never 500', async () => {
    const login = await request(server).post('/api/v1/auth/login').set(CSRF).send(A.owner)
    expect(login.status).toBe(200)
    const cookie = login.headers['set-cookie'] as unknown as string[]
    const token = login.body.token as string
    await ageSession(token)
    const calls = [
      ...Array.from({ length: 10 }, () =>
        request(server).get('/api/v1/auth/me').set('Cookie', cookie).set(CSRF),
      ),
      ...Array.from({ length: 10 }, () =>
        request(server).get('/api/v1/dashboard').set(bearer(token)),
      ),
      request(server).patch('/api/v1/auth/me').set(bearer(token)).send({ locale: 'en' }),
      request(server).patch('/api/v1/auth/me').set(bearer(token)).send({ locale: 'bg' }),
    ]
    const results = await Promise.all(calls)
    for (const r of results) expect(r.status, r.text).toBeLessThan(500)
  })

  it('a logout racing with a burst of reads yields 200 or 401, never 500', async () => {
    const login = await request(server).post('/api/v1/auth/login').set(CSRF).send(A.owner)
    const token = login.body.token as string
    await ageSession(token)
    const reads = Array.from({ length: 15 }, () =>
      request(server).get('/api/v1/auth/me').set(bearer(token)),
    )
    const out = await Promise.all([
      request(server).post('/api/v1/auth/logout').set(bearer(token)),
      ...reads,
    ])
    for (const r of out) expect([200, 204, 401]).toContain(r.status)
    const after = await request(server).get('/api/v1/auth/me').set(bearer(token))
    expect(after.status).toBe(401)
  })
})
