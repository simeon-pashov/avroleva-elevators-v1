import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { disconnectDb } from '../../src/platform/db/prisma.js'
import { app, bearer, createTenant, resetDb, seedAdmin } from '../helpers.js'
import type { TenantFixture } from '../helpers.js'

/**
 * QA 2026-09-10 (step 11): regression for the settings-block reset. Every office settings page
 * PATCHes only its own block; the other blocks (bank details, payment provider, jobs, planning)
 * must survive untouched, and `null` clears the optional due-days override.
 */
let server: Express
let A: TenantFixture

const BANK = {
  beneficiary: 'Тест Лифт ЕООД',
  iban: 'BG80BNBG96611020345678',
  bic: 'BNBGBGSD',
  bankName: 'БНБ',
}

beforeAll(async () => {
  await resetDb()
  await seedAdmin()
  server = app()
  A = await createTenant(server, 'Settings')
  await request(server)
    .patch('/api/v1/tenant')
    .set(bearer(A.ownerToken))
    .send({
      settings: {
        billing: {
          runDay: 5,
          dueDays: 15,
          bank: BANK,
          paymentProvider: 'none',
          showPaymentOnPublicPage: true,
        },
        jobs: { approvalReminderDays: 10, defaultWarrantyMonths: 18, quoteValidDays: 45 },
        planning: { baseAddress: 'гараж', baseLat: 42.7, baseLng: 23.3, avgStopMinutes: 20 },
      },
    })
    .expect(200)
})

afterAll(async () => {
  await disconnectDb()
})

const settings = async () =>
  (await request(server).get('/api/v1/tenant').set(bearer(A.ownerToken)).expect(200)).body.settings

describe('partial settings PATCH keeps the other blocks', () => {
  it('planning-only save keeps billing (bank, provider, run day) and jobs', async () => {
    const before = await settings()
    const r = await request(server)
      .patch('/api/v1/tenant')
      .set(bearer(A.ownerToken))
      .send({ settings: { planning: { ...before.planning, avgStopMinutes: 21 } } })
    expect(r.status, r.text).toBe(200)
    const after = await settings()
    expect(after.planning.avgStopMinutes).toBe(21)
    expect(after.planning.baseAddress).toBe('гараж')
    expect(after.billing).toEqual(before.billing)
    expect(after.jobs).toEqual(before.jobs)
    expect(after.billing.bank).toEqual(BANK)
    expect(after.billing.runDay).toBe(5)
    expect(after.billing.dueDays).toBe(15)
  })
  it('a top-level-only save keeps every block', async () => {
    const before = await settings()
    await request(server)
      .patch('/api/v1/tenant')
      .set(bearer(A.ownerToken))
      .send({ settings: { checkIntervalDays: 31 } })
      .expect(200)
    const after = await settings()
    expect(after.checkIntervalDays).toBe(31)
    expect(after.billing).toEqual(before.billing)
    expect(after.jobs).toEqual(before.jobs)
    expect(after.planning).toEqual(before.planning)
  })
  it('a partial billing save keeps the bank details and the rest of the block', async () => {
    await request(server)
      .patch('/api/v1/tenant')
      .set(bearer(A.ownerToken))
      .send({ settings: { billing: { runDay: 7 } } })
      .expect(200)
    const after = await settings()
    expect(after.billing.runDay).toBe(7)
    expect(after.billing.bank).toEqual(BANK)
    expect(after.billing.showPaymentOnPublicPage).toBe(true)
    expect(after.billing.dueDays).toBe(15)
  })
  it('dueDays: null clears the override (blank field on the billing page)', async () => {
    await request(server)
      .patch('/api/v1/tenant')
      .set(bearer(A.ownerToken))
      .send({ settings: { billing: { dueDays: null } } })
      .expect(200)
    const after = await settings()
    expect(after.billing.dueDays ?? null).toBeNull()
    expect(after.billing.bank).toEqual(BANK)
  })
  it('a bank-import preview (which stores the mapping on the tenant) keeps planning and jobs', async () => {
    const before = await settings()
    const text =
      'Date,Amount,Currency,Counterparty,Details,Reference\n06/09/2026,5.00,EUR,"Anon","nothing",Z1\n'
    await request(server)
      .post('/api/v1/billing/bank-imports/preview')
      .set(bearer(A.ownerToken))
      .send({ filename: 'x.csv', text, preset: 'en_comma_signed' })
      .expect(201)
    const after = await settings()
    expect(after.billing.bankCsvMapping).toBeTruthy()
    expect(after.billing.bank).toEqual(BANK)
    expect(after.planning).toEqual(before.planning)
    expect(after.jobs).toEqual(before.jobs)
  })
})
