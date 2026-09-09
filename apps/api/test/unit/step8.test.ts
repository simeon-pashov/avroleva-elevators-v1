import { describe, expect, it } from 'vitest'
import {
  approvalOverdue,
  canTransition,
  defaultStages,
  isTerminal,
  lineTotalCents,
  openStageCodes,
  orderStages,
  quoteTotals,
  remainingNetCents,
  requiresEvidence,
  summarizeJobs,
  validateStages,
} from '../../src/modules/jobs/index.js'
import type { StageDef } from '../../src/modules/jobs/index.js'
import {
  labelFor,
  parseNominatimAddress,
  toSuggestion,
  createNominatimGeocoder,
} from '../../src/platform/adapters/geocoder/nominatim.js'
import type { NominatimResult } from '../../src/platform/adapters/geocoder/nominatim.js'
import { createStubGeocoder } from '../../src/platform/adapters/geocoder/stub.js'
import { distanceMetres, viewboxFor, withinRadius } from '../../src/modules/registry/index.js'

describe('job stage machine (data)', () => {
  const stages = defaultStages()

  it('ships the default flow with positions and one evidence-gated stage', () => {
    expect(stages.map((s) => s.code)).toEqual([
      'draft',
      'quoted',
      'awaiting_approval',
      'approved',
      'scheduled',
      'in_progress',
      'done',
      'invoiced',
      'rejected',
      'cancelled',
    ])
    expect(stages.map((s) => s.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(requiresEvidence(stages, 'approved')).toBe(true)
    expect(requiresEvidence(stages, 'scheduled')).toBe(false)
    expect(isTerminal(stages, 'invoiced')).toBe(true)
    expect(isTerminal(stages, 'done')).toBe(false)
    expect(openStageCodes(stages)).not.toContain('cancelled')
    expect(validateStages(stages)).toEqual({ ok: true })
  })

  it('allows only the listed transitions', () => {
    expect(canTransition(stages, 'draft', 'quoted')).toBe(true)
    expect(canTransition(stages, 'draft', 'approved')).toBe(false)
    expect(canTransition(stages, 'quoted', 'awaiting_approval')).toBe(true)
    expect(canTransition(stages, 'awaiting_approval', 'approved')).toBe(true)
    expect(canTransition(stages, 'awaiting_approval', 'rejected')).toBe(true)
    expect(canTransition(stages, 'approved', 'scheduled')).toBe(true)
    expect(canTransition(stages, 'scheduled', 'in_progress')).toBe(true)
    expect(canTransition(stages, 'in_progress', 'done')).toBe(true)
    expect(canTransition(stages, 'done', 'invoiced')).toBe(true)
    expect(canTransition(stages, 'invoiced', 'done')).toBe(false)
    expect(canTransition(stages, 'done', 'done')).toBe(false)
    expect(canTransition(stages, 'rejected', 'draft')).toBe(true)
    expect(canTransition(stages, 'nope', 'draft')).toBe(false)
  })

  it('a tenant override can add a stage and gate another one behind evidence', () => {
    const custom: StageDef[] = orderStages([
      ...stages.map((s) =>
        s.code === 'approved'
          ? { ...s, allowedNext: ['parts_ordered', 'scheduled', 'cancelled'] }
          : s.code === 'scheduled'
            ? { ...s, requiresEvidence: true }
            : s,
      ),
      {
        code: 'parts_ordered',
        labelBg: 'Поръчани части',
        labelEn: 'Parts ordered',
        isTerminal: false,
        allowedNext: ['scheduled'],
        requiresEvidence: false,
      },
    ])
    expect(validateStages(custom)).toEqual({ ok: true })
    expect(canTransition(custom, 'approved', 'parts_ordered')).toBe(true)
    expect(canTransition(custom, 'parts_ordered', 'scheduled')).toBe(true)
    expect(requiresEvidence(custom, 'scheduled')).toBe(true)
    expect(custom.find((s) => s.code === 'parts_ordered')?.position).toBe(11)
  })

  it('rejects broken overrides', () => {
    const dup = [...stages, { ...stages[0]! }]
    expect(validateStages(dup)).toMatchObject({ ok: false, code: 'jobs.stages.duplicateCode' })
    const dangling = stages.map((s) =>
      s.code === 'draft' ? { ...s, allowedNext: ['nowhere'] } : s,
    )
    expect(validateStages(dangling)).toMatchObject({ ok: false, code: 'jobs.stages.unknownNext' })
    const missing = stages.filter((s) => s.code !== 'done')
    expect(validateStages(missing)).toMatchObject({
      ok: false,
      code: 'jobs.stages.missingRequired',
      detail: 'done',
    })
    const noTerminal = stages.map((s) => ({ ...s, isTerminal: false }))
    expect(validateStages(noTerminal)).toMatchObject({ ok: false, code: 'jobs.stages.noTerminal' })
  })
})

describe('quote totals and the money-leaking number', () => {
  it('rounds line totals to the cent and VAT once on the net total', () => {
    expect(lineTotalCents(2.5, 333)).toBe(833) // 832.5 -> 833
    expect(lineTotalCents(240, 420)).toBe(100800)
    const lines = [
      { totalCents: lineTotalCents(4, 2850) },
      { totalCents: lineTotalCents(3, 4500) },
      { totalCents: lineTotalCents(1.5, 333) }, // 499.5 -> 500
    ]
    const t = quoteTotals(lines, 20)
    expect(t.netCents).toBe(11400 + 13500 + 500)
    expect(t.vatCents).toBe(Math.round(25400 * 0.2))
    expect(t.totalCents).toBe(t.netCents + t.vatCents)
    expect(quoteTotals(lines, 0).vatCents).toBe(0)
    // Half-up on the VAT: 3 lines of 1 cent at 20 % = 0.6 -> 1
    expect(
      quoteTotals([{ totalCents: 1 }, { totalCents: 1 }, { totalCents: 1 }], 20).vatCents,
    ).toBe(1)
  })

  it('remaining amount deducts deposits and never goes negative', () => {
    expect(remainingNetCents({ netCents: 10000, invoicedCents: 4000 })).toBe(6000)
    expect(remainingNetCents({ netCents: 10000, invoicedCents: 12000 })).toBe(0)
  })

  it('summarises the board: open quotes, awaiting (+overdue), this week, done-not-invoiced', () => {
    const now = new Date('2026-09-10T10:00:00+03:00')
    const weekStart = new Date('2026-09-07T00:00:00+03:00')
    const weekEnd = new Date('2026-09-14T00:00:00+03:00')
    const d = (daysAgo: number) => new Date(now.getTime() - daysAgo * 86_400_000)
    const base = {
      netCents: 10000,
      totalCents: 12000,
      invoicedCents: 0,
      scheduledAt: null,
      quoteSentAt: null,
    }
    const s = summarizeJobs(
      [
        { ...base, status: 'quoted', updatedAt: d(1) },
        { ...base, status: 'awaiting_approval', updatedAt: d(20), quoteSentAt: d(20) },
        { ...base, status: 'awaiting_approval', updatedAt: d(3), quoteSentAt: d(3) },
        {
          ...base,
          status: 'scheduled',
          updatedAt: d(1),
          scheduledAt: new Date('2026-09-11T09:00:00+03:00'),
        },
        {
          ...base,
          status: 'scheduled',
          updatedAt: d(1),
          scheduledAt: new Date('2026-09-20T09:00:00+03:00'),
        },
        { ...base, status: 'in_progress', updatedAt: d(0) },
        { ...base, status: 'done', updatedAt: d(5) },
        { ...base, status: 'done', updatedAt: d(5), invoicedCents: 4000 },
        { ...base, status: 'done', updatedAt: d(5), invoicedCents: 10000 },
        { ...base, status: 'invoiced', updatedAt: d(5), invoicedCents: 10000 },
        { ...base, status: 'rejected', updatedAt: d(5) },
      ],
      { now, approvalReminderDays: 14, weekStart, weekEnd },
    )
    expect(s.openQuotes).toEqual({ count: 3, cents: 36000 })
    expect(s.awaitingApproval).toEqual({ count: 2, cents: 24000, overdue: 1 })
    expect(s.scheduledThisWeek.count).toBe(1)
    expect(s.inProgress.count).toBe(1)
    expect(s.doneNotInvoiced).toEqual({ count: 2, cents: 16000 })
    expect(
      approvalOverdue(
        { status: 'awaiting_approval', quoteSentAt: d(14), updatedAt: d(0) },
        now,
        14,
      ),
    ).toBe(true)
    expect(
      approvalOverdue(
        { status: 'awaiting_approval', quoteSentAt: d(13), updatedAt: d(0) },
        now,
        14,
      ),
    ).toBe(false)
    expect(
      approvalOverdue({ status: 'approved', quoteSentAt: d(30), updatedAt: d(0) }, now, 14),
    ).toBe(false)
  })
})

describe('address search parsing (Nominatim -> building form)', () => {
  const block: NominatimResult = {
    lat: '42.6501',
    lon: '23.3771',
    importance: 0.35,
    class: 'building',
    type: 'apartments',
    name: 'бл. 25',
    display_name: 'бл. 25, ж.к. Младост 1, Младост, София, 1784, България',
    address: {
      building: 'бл. 25',
      suburb: 'ж.к. Младост 1',
      city_district: 'Младост',
      city: 'София',
      postcode: '1784',
      state: 'София-град',
      country_code: 'bg',
    },
  }
  const street: NominatimResult = {
    lat: '42.6977',
    lon: '23.3219',
    importance: 0.42,
    class: 'place',
    type: 'house',
    display_name: '12, улица Раковски, Оборище, София, 1000, България',
    address: {
      house_number: '12',
      road: 'улица Раковски',
      suburb: 'Оборище',
      city: 'София',
      postcode: '1000',
    },
  }
  const road: NominatimResult = {
    lat: '42.69',
    lon: '23.32',
    importance: 0.3,
    class: 'highway',
    type: 'residential',
    display_name: 'улица Раковски, Оборище, София, България',
    address: { road: 'улица Раковски', suburb: 'Оборище', city: 'София' },
  }
  const quarterBlockAsNumber: NominatimResult = {
    lat: '42.65',
    lon: '23.38',
    type: 'house',
    address: { house_number: '31', suburb: 'ж.к. Дружба 2', city: 'София', postcode: '1582' },
  }

  it('splits a panel-block address into district / block and flags it approximate', () => {
    const parts = parseNominatimAddress(block)
    expect(parts).toEqual({
      city: 'София',
      postcode: '1784',
      oblast: 'София-град',
      district: 'ж.к. Младост 1',
      block: '25',
    })
    expect(labelFor(parts, block.display_name!)).toBe('ж.к. Младост 1, бл. 25, София')
    const s = toSuggestion(block)
    expect(s.approximate).toBe(true)
    expect(s.confidence).toBeCloseTo(0.55, 5)
    expect(s.lat).toBeCloseTo(42.6501)
  })

  it('street + house number is exact; a bare road is approximate', () => {
    const s = toSuggestion(street)
    expect(s.address).toEqual({
      city: 'София',
      postcode: '1000',
      district: 'Оборище',
      street: 'улица Раковски',
      number: '12',
    })
    expect(s.label).toBe('Оборище, улица Раковски 12, София')
    expect(s.approximate).toBe(false)
    const r = toSuggestion(road)
    expect(r.approximate).toBe(true)
    expect(r.address.number).toBeUndefined()
  })

  it('a house_number written as "бл. 27" (Sofia OSM data) is the block, not the number', () => {
    const parts = parseNominatimAddress({
      lat: '42.6614',
      lon: '23.3738',
      type: 'apartments',
      name: 'бл. 27',
      address: {
        house_number: 'бл. 27',
        suburb: 'ж.к. Младост 1',
        city: 'София',
        postcode: '1750',
      },
    })
    expect(parts).toEqual({
      city: 'София',
      postcode: '1750',
      district: 'ж.к. Младост 1',
      block: '27',
    })
  })

  it('a house_number in a quarter without a street is the block number', () => {
    const parts = parseNominatimAddress(quarterBlockAsNumber)
    expect(parts.block).toBe('31')
    expect(parts.number).toBeUndefined()
    expect(parts.district).toBe('ж.к. Дружба 2')
  })

  it('the adapter throttles to one request per second and caches repeated queries', async () => {
    const calls: string[] = []
    let t = 1_000_000
    const fetchImpl = (async (url: string) => {
      calls.push(String(url))
      return { ok: true, json: async () => [block] } as unknown as Response
    }) as unknown as typeof fetch
    const geo = createNominatimGeocoder('https://nominatim.example', fetchImpl, {
      minIntervalMs: 50,
      now: () => t,
    })
    const a = geo.search('ж.к. Младост 1 бл. 25', { viewbox: [23.2, 42.6, 23.45, 42.78] })
    const b = geo.search('ул. Раковски 12')
    const before = Date.now()
    const [ra, rb] = await Promise.all([a, b])
    expect(Date.now() - before).toBeGreaterThanOrEqual(45)
    expect(ra).toHaveLength(1)
    expect(rb).toHaveLength(1)
    expect(calls).toHaveLength(2)
    expect(calls[0]).toContain('countrycodes=bg')
    expect(calls[0]).toContain('accept-language=bg')
    expect(calls[0]).toContain('addressdetails=1')
    expect(calls[0]).toContain('viewbox=23.2000%2C42.6000%2C23.4500%2C42.7800')
    expect(calls[0]).toContain('limit=8')
    // Same query again: served from the cache, no third request.
    await geo.search('ж.к. Младост 1 бл. 25', { viewbox: [23.2, 42.6, 23.45, 42.78] })
    expect(calls).toHaveLength(2)
    t += 11 * 60_000 // cache expired
    await geo.search('ж.к. Младост 1 бл. 25', { viewbox: [23.2, 42.6, 23.45, 42.78] })
    expect(calls).toHaveLength(3)
  })

  it('the stub returns block / street / quarter suggestions with parsed parts', async () => {
    const items = await createStubGeocoder().search('ж.к. Младост 1, бл. 25')
    expect(items).toHaveLength(3)
    expect(items[0]!.address).toMatchObject({
      city: 'София',
      district: 'ж.к. Младост 1',
      block: '25',
    })
    expect(items[0]!.approximate).toBe(true)
    expect(items[1]!.kind).toBe('road')
    expect(await createStubGeocoder().search('никъде')).toEqual([])
  })
})

describe('geo helpers', () => {
  it('haversine distance and nearby filter', () => {
    const a = { lat: 42.6977, lng: 23.3219 }
    expect(distanceMetres(a, a)).toBe(0)
    // ~111 m north
    expect(distanceMetres(a, { lat: 42.6987, lng: 23.3219 })).toBeCloseTo(111.2, 0)
    const near = withinRadius(
      a,
      [
        { id: 'far', lat: 42.7, lng: 23.33 },
        { id: 'close', lat: 42.6979, lng: 23.3221 },
        { id: 'edge', lat: 42.6982, lng: 23.3219 },
      ],
      60,
    )
    expect(near.map((p) => p.id)).toEqual(['close', 'edge'])
    expect(near[0]!.distanceM).toBeLessThan(near[1]!.distanceM)
  })

  it('viewbox from a point, from the pins, or Sofia', () => {
    expect(viewboxFor({ lat: 42.7, lng: 23.3 }, [])).toEqual([23.25, 42.66, 23.35, 42.74])
    const box = viewboxFor(null, [
      { lat: 42.6, lng: 23.2 },
      { lat: 42.7, lng: 23.4 },
    ])
    expect(box[0]).toBeLessThan(23.2)
    expect(box[2]).toBeGreaterThan(23.4)
    expect(viewboxFor(null, [])).toEqual([23.2, 42.6, 23.45, 42.78])
  })
})
