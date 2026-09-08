import request from 'supertest'
import type { Express } from 'express'
import { config } from '../src/platform/config.js'
import { prismaBase } from '../src/platform/db/prisma.js'
import { createApp } from '../src/app.js'
import { ensurePlatformAdmin } from '../src/modules/tenancy/index.js'

export const CSRF = { 'X-Requested-With': 'avroleva' }

export function testDbUrl(): string {
  if (config.TEST_DATABASE_URL) return config.TEST_DATABASE_URL
  const u = new URL(config.DATABASE_URL)
  u.pathname = '/avroleva_test'
  return u.toString()
}

export function app(): Express {
  return createApp()
}

/**
 * Truncates every table (order-independent thanks to CASCADE). Guarded: the connected database
 * must be a test database (name contains "test"), so a shell with NODE_ENV unset can never wipe
 * the dev data (it happened once in step 4).
 */
export async function resetDb(): Promise<void> {
  const [{ current_database: name }] = await prismaBase.$queryRawUnsafe<
    Array<{ current_database: string }>
  >('SELECT current_database()')
  if (!/test/i.test(name)) {
    throw new Error(
      `resetDb refused: connected to "${name}", not a test database (NODE_ENV=${config.NODE_ENV}, TEST_DATABASE_URL set: ${!!config.TEST_DATABASE_URL})`,
    )
  }
  await prismaBase.$executeRawUnsafe(
    'TRUNCATE TABLE "audit_log", "domain_event", "event_delivery", "job_run", "notification", "notification_rule", "notification_template", "export_job", "report_run", "idempotency_key", "visit_attachment", "attachment", "device_enrollment_token", "checklist_template", "alarm_device_test", "inspection", "defect", "callback_event", "callback", "payment", "invoice", "invoice_sequence", "visit_technician", "visit", "import_batch", "contract_elevator", "contract", "elevator", "contact", "building", "customer", "session", "user", "tenant", "platform_admin" CASCADE',
  )
}

export const ADMIN = { username: 'admin', password: 'admin12345' }

export async function seedAdmin(): Promise<void> {
  await ensurePlatformAdmin(ADMIN.username, ADMIN.password)
}

export async function adminToken(server: Express): Promise<string> {
  const res = await request(server).post('/api/v1/admin/auth/login').set(CSRF).send(ADMIN)
  if (res.status !== 200) throw new Error(`admin login failed: ${res.status} ${res.text}`)
  return res.body.token as string
}

export interface TenantFixture {
  tenantId: string
  ownerToken: string
  owner: { username: string; password: string }
}

let seq = 0

export async function createTenant(server: Express, name = 'Tenant'): Promise<TenantFixture> {
  seq++
  const admin = await adminToken(server)
  const owner = { username: `owner${seq}_${Date.now() % 100000}`, password: 'password123' }
  const res = await request(server)
    .post('/api/v1/admin/tenants')
    .set('Authorization', `Bearer ${admin}`)
    .send({
      name: `${name} ${seq}`,
      eik: String(100000000 + seq + (Date.now() % 1000000)),
      address: 'София, ул. Тестова 1',
      phone: '02 111 2222',
      emergencyPhone: '0700 11 111',
      locale: 'bg',
      owner: { ...owner, name: `Owner ${seq}` },
    })
  if (res.status !== 201) throw new Error(`tenant create failed: ${res.status} ${res.text}`)
  const login = await request(server).post('/api/v1/auth/login').set(CSRF).send(owner)
  if (login.status !== 200) throw new Error(`login failed: ${login.status} ${login.text}`)
  return { tenantId: res.body.tenant.id as string, ownerToken: login.body.token as string, owner }
}

export function bearer(token: string) {
  return { Authorization: `Bearer ${token}` }
}

export async function createBuilding(
  server: Express,
  token: string,
  district = 'ж.к. Младост 1',
  block = '25',
) {
  const res = await request(server)
    .post('/api/v1/buildings')
    .set(bearer(token))
    .send({ address: { city: 'София', district, block, entrance: 'А' } })
  if (res.status !== 201) throw new Error(`building create failed: ${res.status} ${res.text}`)
  return res.body as { id: string; addressText: string }
}

export async function createElevator(
  server: Express,
  token: string,
  buildingId: string,
  internalNo = 'вх. А',
) {
  const res = await request(server)
    .post('/api/v1/elevators')
    .set(bearer(token))
    .send({ buildingId, internalNo, stops: 8, regNo: `СФ-${Math.floor(Math.random() * 100000)}` })
  if (res.status !== 201) throw new Error(`elevator create failed: ${res.status} ${res.text}`)
  return res.body as { id: string }
}

export async function createCustomer(server: Express, token: string, name = 'ЕС Тест') {
  const res = await request(server)
    .post('/api/v1/customers')
    .set(bearer(token))
    .send({ name, kind: 'etazhna_sobstvenost' })
  if (res.status !== 201) throw new Error(`customer create failed: ${res.status} ${res.text}`)
  return res.body as { id: string }
}
