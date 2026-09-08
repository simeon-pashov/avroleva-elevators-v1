import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { disconnectDb, prismaBase } from '../../src/platform/db/prisma.js'
import { events } from '../../src/platform/events/bus.js'
import { newId } from '../../src/platform/ids.js'
import { registerSubscribers, SUBSCRIPTIONS } from '../../src/subscribers.js'
import { ensureJobsRegistered } from '../../src/worker.js'
import { checklists } from '../../src/modules/maintenance/index.js'
import * as notifications from '../../src/modules/notifications/index.js'
import * as billing from '../../src/modules/billing/index.js'
import { app, bearer, createCustomer, createTenant, resetDb, seedAdmin } from '../helpers.js'
import type { TenantFixture } from '../helpers.js'

/**
 * Step 6 (QA) regressions:
 * - the overdue roll runs before every billing read, so concurrent readers raced and each emitted
 *   InvoiceOverdue for the same invoices (the demo inbox showed 3-5 rows per invoice);
 * - the seed publishes months of history through the real services; without acknowledging those
 *   events the outbox sweep delivered all of them as fresh notifications on the first API start.
 */
let server: Express
let A: TenantFixture

beforeAll(async () => {
  await resetDb()
  await seedAdmin()
  await checklists.ensureSystemTemplates()
  await notifications.ensureSystemTemplates()
  registerSubscribers()
  ensureJobsRegistered()
  server = app()
  A = await createTenant(server, 'Gamma')
})

afterAll(async () => {
  await disconnectDb()
})

describe('billing.rollStatuses under concurrency', () => {
  it('emits exactly one InvoiceOverdue per invoice when several callers roll at once', async () => {
    const customerId = (await createCustomer(server, A.ownerToken, 'ЕС Гама')).id
    const b = await request(server)
      .post('/api/v1/buildings')
      .set(bearer(A.ownerToken))
      .send({ customerId, address: { city: 'София', street: 'ул. Тестова', number: '7' } })
    expect(b.status, b.text).toBe(201)
    const e = await request(server)
      .post('/api/v1/elevators')
      .set(bearer(A.ownerToken))
      .send({ buildingId: b.body.id, internalNo: 'главен', stops: 6 })
    expect(e.status, e.text).toBe(201)
    const contract = await request(server)
      .post('/api/v1/contracts')
      .set(bearer(A.ownerToken))
      .send({
        customerId,
        buildingId: b.body.id,
        startDate: '2026-01-01',
        lines: [{ elevatorId: e.body.id, monthlyPriceCents: 4000 }],
      })
    expect(contract.status, contract.text).toBe(201)

    const n = 6
    for (let i = 0; i < n; i++) {
      await prismaBase.invoice.create({
        data: {
          id: newId(),
          tenantId: A.tenantId,
          contractId: contract.body.id,
          buildingId: b.body.id,
          customerId,
          number: i + 1,
          periodStart: new Date(`2026-0${i + 1}-01T00:00:00Z`),
          periodEnd: new Date(`2026-0${i + 1}-28T00:00:00Z`),
          issuedAt: new Date(`2026-0${i + 1}-01T00:00:00Z`),
          dueAt: new Date(`2026-0${i + 1}-15T00:00:00Z`),
          amountCents: 4000,
          vatCents: 800,
          totalCents: 4800,
          status: 'issued',
        },
      })
    }

    const rolled = await Promise.all([
      billing.rollStatuses(A.tenantId),
      billing.rollStatuses(A.tenantId),
      billing.rollStatuses(A.tenantId),
      billing.rollStatuses(A.tenantId),
    ])
    expect(rolled.reduce((s, x) => s + x, 0)).toBe(n)
    expect(
      await prismaBase.invoice.count({ where: { tenantId: A.tenantId, status: 'overdue' } }),
    ).toBe(n)
    expect(
      await prismaBase.domainEvent.count({
        where: { tenantId: A.tenantId, type: 'InvoiceOverdue' },
      }),
    ).toBe(n)
    // and nothing left to roll
    expect(await billing.rollStatuses(A.tenantId)).toBe(0)
  })
})

describe('events.acknowledge (seeded history is not news)', () => {
  it('marks a tenant’s events delivered so the sweep does not replay them', async () => {
    const calls: string[] = []
    const unsubscribe = events.subscribe(
      'QaSeedProbe',
      async (e) => {
        calls.push(e.id)
      },
      'qa.probe',
    )
    try {
      // An event written without any delivery (what the seed process produces).
      const stale = await prismaBase.domainEvent.create({
        data: {
          id: newId(),
          tenantId: A.tenantId,
          type: 'QaSeedProbe',
          version: 1,
          aggregateType: 'probe',
          aggregateId: newId(),
          payload: {},
        },
      })
      // Without acknowledgement the sweep would (re)deliver it.
      const first = await events.sweep(24)
      expect(first.enqueued).toBe(1)
      await new Promise((r) => setTimeout(r, 50))
      expect(calls).toEqual([stale.id])

      const fresh = await prismaBase.domainEvent.create({
        data: {
          id: newId(),
          tenantId: A.tenantId,
          type: 'QaSeedProbe',
          version: 1,
          aggregateType: 'probe',
          aggregateId: newId(),
          payload: {},
        },
      })
      const written = await events.acknowledge(A.tenantId, [
        { type: 'QaSeedProbe', name: 'qa.probe' },
      ])
      expect(written).toBe(1) // the stale one already has its delivery row
      const row = await prismaBase.eventDelivery.findUnique({
        where: { eventId_handler: { eventId: fresh.id, handler: 'qa.probe' } },
      })
      expect(row?.status).toBe('done')

      const second = await events.sweep(24)
      expect(second.enqueued).toBe(0)
      await new Promise((r) => setTimeout(r, 50))
      expect(calls).toEqual([stale.id])
    } finally {
      unsubscribe()
    }
  })

  it('covers every handler the app registers, keyed by the same names', () => {
    const names = new Set(SUBSCRIPTIONS.map((s) => s.name))
    expect(names).toEqual(
      new Set([
        'registry.recomputeSchedule',
        'notifications.rules',
        'notifications.tenantDeletion',
      ]),
    )
    expect(SUBSCRIPTIONS.filter((s) => s.type === 'InvoiceIssued')).toHaveLength(1)
  })
})
