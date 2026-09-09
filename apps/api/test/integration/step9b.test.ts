import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { randomUUID } from 'node:crypto'
import { disconnectDb, prismaBase } from '../../src/platform/db/prisma.js'
import { addDays, todayInSofia } from '../../src/platform/clock.js'
import { runJob } from '../../src/platform/jobs/registry.js'
import { registerSubscribers } from '../../src/subscribers.js'
import { ensureJobsRegistered } from '../../src/worker.js'
import { checklists } from '../../src/modules/maintenance/index.js'
import * as notifications from '../../src/modules/notifications/index.js'
import * as billing from '../../src/modules/billing/index.js'
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

/**
 * Step 9, task B: building access links (magic link) + the public statement page `/s/:token`.
 * Runs against its own test database (TEST_DATABASE_URL=...avroleva_test_b) so it never collides
 * with a concurrent run of the other step 9 suite.
 */
let server: Express
let A: TenantFixture
let B: TenantFixture
let admin: string
let techToken: string
let customerId: string
let buildingId: string
let elevatorId: string
let bBuildingId: string
let invoiceId: string
let invoiceRef: string
let link: { id: string; token: string; url: string }
let visitsLink: { id: string; token: string; url: string }
const today = todayInSofia()
const thisMonth = today.slice(0, 7)

function tokenOf(url: string): string {
  return url.split('/s/')[1]!
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
  A = await createTenant(server, 'Links A')
  B = await createTenant(server, 'Links B')
  customerId = (await createCustomer(server, A.ownerToken, 'ЕС „Линкова 1“')).id
  buildingId = (await createBuilding(server, A.ownerToken)).id
  elevatorId = (await createElevator(server, A.ownerToken, buildingId)).id
  await request(server)
    .post('/api/v1/contacts')
    .set(bearer(A.ownerToken))
    .send({
      buildingId,
      customerId,
      name: 'Петя Димова',
      role: 'house_manager',
      phone: '0888 123 456',
      hasViber: true,
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
  // The building belongs to the customer (the page shows the customer's name, never a contact).
  await prismaBase.building.update({ where: { id: buildingId }, data: { customerId } })
  bBuildingId = (await createBuilding(server, B.ownerToken, 'ж.к. Дружба', '9')).id
  // Default notification rules are created on a tenant's first read (step 5).
  await request(server).get('/api/v1/notifications/rules').set(bearer(A.ownerToken)).expect(200)
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
          showPaymentOnPublicPage: false,
        },
      },
    })
  expect(settings.status, settings.text).toBe(200)
  const techUsername = `tech9b_${Date.now() % 100000}`
  await request(server)
    .post('/api/v1/users')
    .set(bearer(A.ownerToken))
    .send({
      username: techUsername,
      password: 'password123',
      name: 'Иван Монтьор',
      role: 'technician',
    })
    .expect(201)
  const techLogin = await request(server)
    .post('/api/v1/auth/login')
    .set(CSRF)
    .send({ username: techUsername, password: 'password123' })
  expect(techLogin.status, techLogin.text).toBe(200)
  techToken = techLogin.body.token
  // One issued invoice for this month so the page has an open invoice, a reference and a QR.
  const gen = await request(server)
    .post('/api/v1/billing/invoices/generate')
    .set(bearer(A.ownerToken))
    .send({ period: thisMonth })
  expect(gen.status, gen.text).toBe(201)
  invoiceId = gen.body.invoices[0].id
  invoiceRef = gen.body.invoices[0].paymentReference
})

afterAll(async () => {
  await disconnectDb()
})

describe('access links: create, list, status', () => {
  it('creates a 12-month statement link with a 32-hex token, audited, and lists it', async () => {
    const res = await request(server)
      .post(`/api/v1/buildings/${buildingId}/access-links`)
      .set(bearer(A.ownerToken))
      .send({})
    expect(res.status, res.text).toBe(201)
    expect(res.body.url).toContain('/s/')
    expect(tokenOf(res.body.url)).toMatch(/^[0-9a-f]{32}$/)
    expect(res.body).toMatchObject({
      buildingId,
      scope: 'statement',
      state: 'active',
      useCount: 0,
      lastUsedAt: null,
      revokedAt: null,
    })
    expect(res.body.createdByName).toMatch(/^Owner/)
    expect(res.body.emailSubject).toContain('ж.к. Младост 1')
    expect(res.body.emailBody).toContain(res.body.url)
    expect(res.body.viberUrl.startsWith('viber://forward?text=')).toBe(true)
    expect(decodeURIComponent(res.body.viberUrl)).toContain(res.body.url)
    const expires = new Date(res.body.expiresAt)
    const expected = new Date()
    expected.setUTCMonth(expected.getUTCMonth() + 12)
    expect(Math.abs(expires.getTime() - expected.getTime())).toBeLessThan(2 * 86_400_000)
    link = { id: res.body.id, token: tokenOf(res.body.url), url: res.body.url }
    const audit = await prismaBase.auditLog.findFirst({
      where: { tenantId: A.tenantId, action: 'accessLink.create', entityId: link.id },
    })
    expect(audit).not.toBeNull()
    expect(audit!.actorId).not.toBeNull()

    const list = await request(server)
      .get(`/api/v1/buildings/${buildingId}/access-links`)
      .set(bearer(A.ownerToken))
    expect(list.status).toBe(200)
    expect(list.body.items.map((l: { id: string }) => l.id)).toEqual([link.id])
    // The DTO never leaks the raw token apart from the URL itself.
    expect(JSON.stringify(list.body)).not.toContain(`"token"`)

    const status = await request(server)
      .get(`/api/v1/buildings/${buildingId}/access-link-status`)
      .set(bearer(A.ownerToken))
    expect(status.status).toBe(200)
    expect(status.body).toMatchObject({
      buildingId,
      active: true,
      linkId: link.id,
      scope: 'statement',
    })
  })

  it('a second link with the wider scope and a custom validity; status shows the newest active', async () => {
    const res = await request(server)
      .post(`/api/v1/buildings/${buildingId}/access-links`)
      .set(bearer(A.ownerToken))
      .send({ scope: 'statement_and_visits', expiresInMonths: 3 })
    expect(res.status, res.text).toBe(201)
    expect(res.body.scope).toBe('statement_and_visits')
    const expires = new Date(res.body.expiresAt)
    const expected = new Date()
    expected.setUTCMonth(expected.getUTCMonth() + 3)
    expect(Math.abs(expires.getTime() - expected.getTime())).toBeLessThan(2 * 86_400_000)
    visitsLink = { id: res.body.id, token: tokenOf(res.body.url), url: res.body.url }
    const status = await request(server)
      .get(`/api/v1/buildings/${buildingId}/access-link-status`)
      .set(bearer(A.ownerToken))
    expect(status.body).toMatchObject({
      active: true,
      linkId: visitsLink.id,
      scope: 'statement_and_visits',
    })
    await request(server)
      .post(`/api/v1/buildings/${buildingId}/access-links`)
      .set(bearer(A.ownerToken))
      .send({ expiresInMonths: 0 })
      .expect(400)
  })
})

describe('the public statement page', () => {
  it('renders the building, the balance, the open invoice with reference and EPC QR; counts the open', async () => {
    const page = await request(server).get(`/s/${link.token}`)
    expect(page.status, page.text).toBe(200)
    expect(page.headers['cache-control']).toBe('no-store')
    expect(page.text).toContain('noindex, nofollow')
    expect(page.text).toContain('<html lang="bg">')
    expect(page.text).toContain('Links A')
    expect(page.text).toContain('ж.к. Младост 1')
    expect(page.text).toContain('ЕС „Линкова 1“')
    expect(page.text).toContain('Текущо салдо')
    expect(page.text).toContain(invoiceRef)
    expect(page.text).toContain('BG80 BNBG 9661 1020 3456 78')
    expect(page.text).toContain('<svg')
    expect(page.text).toContain('print.js')
    expect(page.text).toContain('Справката е достъпна само чрез този линк')
    // Ledger with the invoice line and the running balance.
    expect(page.text).toContain('Фактури и плащания')
    expect(page.text).toContain(`${thisMonth}`)
    // No payment button without a provider, no personal contact data, no visits for this scope.
    expect(page.text).not.toContain('class="btn pay-btn"')
    expect(page.text).not.toContain('Петя Димова')
    expect(page.text).not.toContain('petya@example.com')
    expect(page.text).not.toContain('Посещения (')

    const row = await prismaBase.buildingAccessLink.findUnique({ where: { id: link.id } })
    expect(row!.useCount).toBe(1)
    expect(row!.lastUsedAt).not.toBeNull()
    expect(row!.lastIpHash).toMatch(/^[0-9a-f]{32}$/)
    // Writes are throttled per minute; the opens in between land with the next write.
    await request(server).get(`/s/${link.token}`).expect(200)
    expect(
      (await prismaBase.buildingAccessLink.findUnique({ where: { id: link.id } }))!.useCount,
    ).toBe(1)
    billing.resetAccessLinkOpenThrottle()
    await request(server).get(`/s/${link.token}`).expect(200)
    expect(
      (await prismaBase.buildingAccessLink.findUnique({ where: { id: link.id } }))!.useCount,
    ).toBe(3)
    // Nothing is audited for an open.
    expect(
      await prismaBase.auditLog.count({
        where: { tenantId: A.tenantId, action: { startsWith: 'accessLink.open' } },
      }),
    ).toBe(0)
  })

  it('unknown, malformed tokens answer the 404 page', async () => {
    const res = await request(server).get('/s/00000000000000000000000000000000')
    expect(res.status).toBe(404)
    expect(res.text).toContain('Справката не е налична')
    await request(server).get('/s/nope').expect(404)
    await request(server).get('/s/0123456789ABCDEF0123456789ABCDEF').expect(404)
  })

  it('scope statement_and_visits shows visits with technician names, callbacks, defects and the next inspection', async () => {
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
    const cb = await request(server).post('/api/v1/callbacks').set(bearer(A.ownerToken)).send({
      elevatorId,
      classification: 'breakdown',
      description: 'Не тръгва',
    })
    expect(cb.status, cb.text).toBe(201)
    const d = await request(server).post('/api/v1/defects').set(bearer(A.ownerToken)).send({
      elevatorId,
      catalogCode: 'other',
      description: 'Пукнато огледало',
      severity: 'low',
    })
    expect(d.status, d.text).toBe(201)
    await prismaBase.elevator.update({
      where: { id: elevatorId },
      data: { nextInspectionAt: new Date('2027-03-15T00:00:00Z') },
    })

    const page = await request(server).get(`/s/${visitsLink.token}`)
    expect(page.status, page.text).toBe(200)
    expect(page.text).toContain('Посещения (')
    expect(page.text).toContain('Иван Петров, Георги Илиев')
    expect(page.text).toContain('Функционална проверка')
    expect(page.text).toContain('Аварии (')
    expect(page.text).toContain('повреда')
    expect(page.text).toContain('Пукнато огледало')
    expect(page.text).toContain('март 2027')
    // Callback / visit notes and the reporter never leak; the statement-only link stays narrow.
    expect(page.text).not.toContain('Всичко наред.')
    const narrow = await request(server).get(`/s/${link.token}`)
    expect(narrow.text).not.toContain('Иван Петров')
    expect(narrow.text).not.toContain('Пукнато огледало')
  })

  it('"Плати" appears only with an enabled provider; POST pay redirects to the hosted page', async () => {
    // Provider none: no button, and a POST is refused with the page's error box.
    const refused = await request(server)
      .post(`/s/${link.token}/pay/${invoiceId}`)
      .type('form')
      .send({})
    expect(refused.status).toBe(409)
    expect(refused.text).toContain('class="err"')
    const me = await request(server).get('/api/v1/tenant').set(bearer(A.ownerToken))
    await request(server)
      .patch('/api/v1/tenant')
      .set(bearer(A.ownerToken))
      .send({ settings: { billing: { ...me.body.settings.billing, paymentProvider: 'demo' } } })
      .expect(200)
    // demo without demoMode is a disabled provider: still no button.
    const off = await request(server).get(`/s/${link.token}`)
    expect(off.text).not.toContain('class="btn pay-btn"')
    await request(server)
      .post(`/api/v1/admin/tenants/${A.tenantId}/demo-mode`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ enabled: true })
      .expect(200)
    const on = await request(server).get(`/s/${link.token}`)
    expect(on.text).toContain('class="btn pay-btn"')
    expect(on.text).toContain('Плати')
    expect(on.text).toContain(`/s/${link.token}/pay/${invoiceId}`)
    const pay = await request(server)
      .post(`/s/${link.token}/pay/${invoiceId}`)
      .type('form')
      .send({})
    expect(pay.status, pay.text).toBe(303)
    expect(pay.headers.location).toMatch(/\/pay\/demo\/[0-9a-f]{32}$/)
    const plAudit = await prismaBase.auditLog.findFirst({
      where: { tenantId: A.tenantId, action: 'payment_link.create', entityId: invoiceId },
    })
    expect(plAudit!.actorType).toBe('system')
    // An invoice of another building / a foreign tenant: 404, never a link.
    await request(server)
      .post(`/s/${link.token}/pay/${randomUUID()}`)
      .type('form')
      .send({})
      .expect(404)
    await request(server).post(`/s/${link.token}/pay/nope`).type('form').send({}).expect(404)
    await request(server)
      .post(`/api/v1/admin/tenants/${A.tenantId}/demo-mode`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ enabled: false })
      .expect(200)
  })
})

describe('rotate, revoke, expiry', () => {
  it('rotate revokes the old token and issues a new one with the same scope', async () => {
    const res = await request(server)
      .post(`/api/v1/buildings/${buildingId}/access-links/${link.id}/rotate`)
      .set(bearer(A.ownerToken))
    expect(res.status, res.text).toBe(200)
    expect(res.body.id).not.toBe(link.id)
    expect(res.body.scope).toBe('statement')
    expect(res.body.state).toBe('active')
    const newToken = tokenOf(res.body.url)
    expect(newToken).not.toBe(link.token)
    await request(server).get(`/s/${link.token}`).expect(404)
    await request(server).get(`/s/${newToken}`).expect(200)
    const list = await request(server)
      .get(`/api/v1/buildings/${buildingId}/access-links`)
      .set(bearer(A.ownerToken))
    const old = list.body.items.find((l: { id: string }) => l.id === link.id)
    expect(old.state).toBe('revoked')
    expect(old.revokedAt).not.toBeNull()
    expect(
      await prismaBase.auditLog.findFirst({
        where: { tenantId: A.tenantId, action: 'accessLink.rotate' },
      }),
    ).not.toBeNull()
    link = { id: res.body.id, token: newToken, url: res.body.url }
  })

  it('revoke makes the page a 404 and is idempotent', async () => {
    const res = await request(server)
      .post(`/api/v1/buildings/${buildingId}/access-links/${link.id}/revoke`)
      .set(bearer(A.ownerToken))
    expect(res.status, res.text).toBe(200)
    expect(res.body.state).toBe('revoked')
    await request(server).get(`/s/${link.token}`).expect(404)
    await request(server)
      .post(`/s/${link.token}/pay/${invoiceId}`)
      .type('form')
      .send({})
      .expect(404)
    const again = await request(server)
      .post(`/api/v1/buildings/${buildingId}/access-links/${link.id}/revoke`)
      .set(bearer(A.ownerToken))
    expect(again.body.revokedAt).toBe(res.body.revokedAt)
    expect(
      await prismaBase.auditLog.count({
        where: { tenantId: A.tenantId, action: 'accessLink.revoke' },
      }),
    ).toBe(1)
  })

  it('an expired link answers 404 and is not the active one', async () => {
    const res = await request(server)
      .post(`/api/v1/buildings/${buildingId}/access-links`)
      .set(bearer(A.ownerToken))
      .send({})
    expect(res.status).toBe(201)
    await prismaBase.buildingAccessLink.update({
      where: { id: res.body.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    })
    await request(server)
      .get(`/s/${tokenOf(res.body.url)}`)
      .expect(404)
    const list = await request(server)
      .get(`/api/v1/buildings/${buildingId}/access-links`)
      .set(bearer(A.ownerToken))
    expect(list.body.items.find((l: { id: string }) => l.id === res.body.id).state).toBe('expired')
    const status = await request(server)
      .get(`/api/v1/buildings/${buildingId}/access-link-status`)
      .set(bearer(A.ownerToken))
    expect(status.body.active).toBe(true)
    expect(status.body.linkId).toBe(visitsLink.id)
  })
})

describe('send by e-mail and Viber', () => {
  it('e-mail goes to the primary contact (or the given address) through statement_link', async () => {
    const res = await request(server)
      .post(`/api/v1/buildings/${buildingId}/access-links/${visitsLink.id}/send`)
      .set(bearer(A.ownerToken))
      .send({ channel: 'email', message: 'Моля, прегледайте салдото.' })
    expect(res.status, res.text).toBe(200)
    expect(res.body.link.id).toBe(visitsLink.id)
    expect(res.body.viber).toBeNull()
    const n = await prismaBase.notification.findUnique({ where: { id: res.body.notificationId } })
    expect(n!.channel).toBe('email')
    expect(n!.to).toBe('petya@example.com')
    expect(n!.subject).toBe('Вашата справка — София, ж.к. Младост 1, бл. 25, вх. А')
    expect(n!.body).toContain(visitsLink.url)
    expect(n!.body).toContain('Петя Димова')
    expect(n!.body).toContain('Моля, прегледайте салдото.')
    expect(n!.relatedType).toBe('building')
    expect(n!.relatedId).toBe(buildingId)
    const other = await request(server)
      .post(`/api/v1/buildings/${buildingId}/access-links/${visitsLink.id}/send`)
      .set(bearer(A.ownerToken))
      .send({ channel: 'email', email: 'x@example.com' })
    expect(other.status).toBe(200)
    expect(
      (await prismaBase.notification.findUnique({ where: { id: other.body.notificationId } }))!.to,
    ).toBe('x@example.com')
    expect(
      await prismaBase.auditLog.count({
        where: { tenantId: A.tenantId, action: 'accessLink.send' },
      }),
    ).toBe(2)
  })

  it('Viber answers a viber:// deep link with the text', async () => {
    const res = await request(server)
      .post(`/api/v1/buildings/${buildingId}/access-links/${visitsLink.id}/send`)
      .set(bearer(A.ownerToken))
      .send({ channel: 'viber' })
    expect(res.status, res.text).toBe(200)
    expect(res.body.viber.url.startsWith('viber://')).toBe(true)
    expect(res.body.viber.text).toContain(visitsLink.url)
    expect(res.body.viber.text).toContain('Links A')
    const n = await prismaBase.notification.findUnique({ where: { id: res.body.notificationId } })
    expect(n!.channel).toBe('viber_link')
    // The Viber adapter normalises the contact's number to international digits.
    expect(n!.to).toBe('+359888123456')
  })

  it('a revoked link cannot be sent; a building without contacts needs an address', async () => {
    await request(server)
      .post(`/api/v1/buildings/${buildingId}/access-links/${link.id}/send`)
      .set(bearer(A.ownerToken))
      .send({ channel: 'email' })
      .expect(409)
    const bLink = await request(server)
      .post(`/api/v1/buildings/${bBuildingId}/access-links`)
      .set(bearer(B.ownerToken))
      .send({})
    expect(bLink.status).toBe(201)
    const noEmail = await request(server)
      .post(`/api/v1/buildings/${bBuildingId}/access-links/${bLink.body.id}/send`)
      .set(bearer(B.ownerToken))
      .send({ channel: 'email' })
    expect(noEmail.status).toBe(400)
    expect(noEmail.body.code).toBe('accessLinks.noEmail')
    const noPhone = await request(server)
      .post(`/api/v1/buildings/${bBuildingId}/access-links/${bLink.body.id}/send`)
      .set(bearer(B.ownerToken))
      .send({ channel: 'viber' })
    expect(noPhone.status).toBe(400)
    expect(noPhone.body.code).toBe('accessLinks.noPhone')
  })
})

describe('the link reaches dunning e-mails and reports', () => {
  it('dunning e-mail carries the statement URL; with no active link one is created by the system', async () => {
    // Revoke the last active link so the notifier has to create one.
    await request(server)
      .post(`/api/v1/buildings/${buildingId}/access-links/${visitsLink.id}/revoke`)
      .set(bearer(A.ownerToken))
      .expect(200)
    const before = await request(server)
      .get(`/api/v1/buildings/${buildingId}/access-link-status`)
      .set(bearer(A.ownerToken))
    expect(before.body.active).toBe(false)

    const r = await request(server)
      .post('/api/v1/billing/invoices/generate')
      .set(bearer(A.ownerToken))
      .send({ period: '2026-01' })
    expect(r.status, r.text).toBe(201)
    const overdueId = r.body.invoices[0].id as string
    await prismaBase.invoice.update({
      where: { id: overdueId },
      data: { dueAt: new Date(addDays(today, -20) + 'T00:00:00Z') },
    })
    const job = (await runJob('billing.dunning')) as Record<string, { reached: number }>
    expect(job[A.tenantId]!.reached).toBeGreaterThanOrEqual(1)
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
    expect(email.body).toContain('Вашата справка онлайн: ')
    expect(email.body).toMatch(/\/s\/[0-9a-f]{32}/)
    const after = await request(server)
      .get(`/api/v1/buildings/${buildingId}/access-link-status`)
      .set(bearer(A.ownerToken))
    expect(after.body.active).toBe(true)
    expect(after.body.scope).toBe('statement')
    const autoAudit = await prismaBase.auditLog.findFirst({
      where: { tenantId: A.tenantId, action: 'accessLink.autoCreate' },
    })
    expect(autoAudit!.actorType).toBe('system')
    // The URL in the e-mail is the auto-created link and it opens the page.
    const url = email.body.match(/https?:\/\/\S+\/s\/([0-9a-f]{32})/)!
    await request(server).get(`/s/${url[1]}`).expect(200)
    // A second e-mail reuses the same link instead of creating another.
    expect(
      await prismaBase.buildingAccessLink.count({
        where: { tenantId: A.tenantId, buildingId, revokedAt: null, expiresAt: { gt: new Date() } },
      }),
    ).toBe(1)
  })

  it('the statement e-mail carries the same URL', async () => {
    const res = await request(server)
      .post(`/api/v1/reports/statement/${buildingId}/send`)
      .set(bearer(A.ownerToken))
      .send({})
    expect(res.status, res.text).toBe(201)
    const n = await prismaBase.notification.findUnique({ where: { id: res.body.notificationId } })
    expect(n!.body).toContain('Вашата справка онлайн: ')
    expect(n!.body).toMatch(/\/s\/[0-9a-f]{32}/)
    const status = await request(server)
      .get(`/api/v1/buildings/${buildingId}/access-link-status`)
      .set(bearer(A.ownerToken))
    expect(n!.body).toContain(`/s/`)
    expect(status.body.active).toBe(true)
    expect(
      await prismaBase.buildingAccessLink.count({
        where: { tenantId: A.tenantId, buildingId, revokedAt: null, expiresAt: { gt: new Date() } },
      }),
    ).toBe(1)
  })
})

describe('tenant isolation and roles', () => {
  it('B answers 404 on A resources; a technician gets 403 except on the status', async () => {
    const b = bearer(B.ownerToken)
    await request(server).get(`/api/v1/buildings/${buildingId}/access-links`).set(b).expect(404)
    await request(server)
      .post(`/api/v1/buildings/${buildingId}/access-links`)
      .set(b)
      .send({})
      .expect(404)
    await request(server)
      .post(`/api/v1/buildings/${buildingId}/access-links/${visitsLink.id}/rotate`)
      .set(b)
      .expect(404)
    await request(server)
      .post(`/api/v1/buildings/${buildingId}/access-links/${visitsLink.id}/revoke`)
      .set(b)
      .expect(404)
    await request(server)
      .post(`/api/v1/buildings/${buildingId}/access-links/${visitsLink.id}/send`)
      .set(b)
      .send({ channel: 'email', email: 'x@example.com' })
      .expect(404)
    await request(server)
      .get(`/api/v1/buildings/${buildingId}/access-link-status`)
      .set(b)
      .expect(404)
    // A link id of A under a building of B: 404 too.
    await request(server)
      .post(`/api/v1/buildings/${bBuildingId}/access-links/${visitsLink.id}/rotate`)
      .set(b)
      .expect(404)

    const t = bearer(techToken)
    await request(server).get(`/api/v1/buildings/${buildingId}/access-links`).set(t).expect(403)
    await request(server)
      .post(`/api/v1/buildings/${buildingId}/access-links`)
      .set(t)
      .send({})
      .expect(403)
    await request(server)
      .post(`/api/v1/buildings/${buildingId}/access-links/${visitsLink.id}/send`)
      .set(t)
      .send({ channel: 'email' })
      .expect(403)
    const status = await request(server)
      .get(`/api/v1/buildings/${buildingId}/access-link-status`)
      .set(t)
    expect(status.status).toBe(200)
    expect(status.body.active).toBe(true)
    expect(JSON.stringify(status.body)).not.toContain('/s/')
  })
})
