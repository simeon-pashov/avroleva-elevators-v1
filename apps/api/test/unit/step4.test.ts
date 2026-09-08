import { describe, expect, it } from 'vitest'
import {
  applicableItems,
  summarizeChecklist,
  syncPushItem,
  tenantSettings,
} from '@avroleva/contracts'
import type { ChecklistItemDef } from '@avroleva/contracts'
import { checklistTemplates } from '@avroleva/domain-data'
import { qualityFlags } from '../../src/modules/visits/index.js'
import { clockFlags } from '../../src/modules/callbacks/index.js'
import { clockSuspect } from '../../src/platform/clock.js'
import { signFile, signedFileUrl, verifyFileSignature } from '../../src/platform/signedUrl.js'
import { canonical, requestHash } from '../../src/platform/http/idempotency.js'
import { isTokenShapeValid } from '../../src/modules/tenancy/domain/session.js'

const template = checklistTemplates.find((t) => t.key === 'functional_check')!
const items = template.items as ChecklistItemDef[]
const codes = (xs: Array<{ code: string }>) => xs.map((x) => x.code)

describe('checklist template as data', () => {
  it('ships the functional-check template v1 with every group referenced by its items', () => {
    expect(template.version).toBe(1)
    const groups = new Set(template.groups.map((g) => g.code))
    for (const i of items) expect(groups.has(i.group), i.code).toBe(true)
    expect(new Set(items.map((i) => i.code)).size).toBe(items.length)
    for (const i of items) expect(i.bg.length).toBeGreaterThan(3)
  })

  it('filters by drive type: electric gets the machine-room items, hydraulic the hydraulic ones', () => {
    const electric = codes(
      applicableItems(items, { driveType: 'electric', doorType: 'manual', goodsOnly: false }),
    )
    const hydraulic = codes(
      applicableItems(items, { driveType: 'hydraulic', doorType: 'manual', goodsOnly: false }),
    )
    expect(electric).toContain('F5')
    expect(electric).not.toContain('G1')
    expect(hydraulic).toContain('G1')
    expect(hydraulic).not.toContain('F1')
    // MRL is an electric drive without a machine room but with the same traction checks.
    expect(
      codes(applicableItems(items, { driveType: 'mrl', doorType: 'auto', goodsOnly: false })),
    ).toContain('F7')
  })

  it('filters by door type: automatic doors drop the semi-automatic lock items and vice versa', () => {
    const auto = codes(
      applicableItems(items, { driveType: 'electric', doorType: 'auto', goodsOnly: false }),
    )
    const semi = codes(
      applicableItems(items, { driveType: 'electric', doorType: 'semi_auto', goodsOnly: false }),
    )
    expect(auto).toContain('C2')
    expect(auto).not.toContain('B2')
    expect(semi).toContain('B2')
    expect(semi).not.toContain('C1')
  })

  it('goods-only items appear only for goods-only lifts; common items always', () => {
    const passenger = codes(
      applicableItems(items, { driveType: 'electric', doorType: 'manual', goodsOnly: false }),
    )
    const goods = codes(
      applicableItems(items, { driveType: 'electric', doorType: 'manual', goodsOnly: true }),
    )
    expect(passenger).not.toContain('D1')
    expect(goods).toContain('D1')
    for (const c of ['A1', 'E1', 'H1', 'I1']) {
      expect(passenger).toContain(c)
      expect(goods).toContain(c)
    }
  })

  it('summarises results', () => {
    expect(
      summarizeChecklist([
        { result: 'ok' },
        { result: 'ok' },
        { result: 'defect' },
        { result: 'na' },
      ]),
    ).toEqual({ ok: 2, defect: 1, na: 1 })
  })
})

describe('quality flags', () => {
  const settings = tenantSettings.parse({})
  const now = new Date('2026-09-08T10:00:00Z')
  const base = {
    kind: 'functional_check' as const,
    startedAt: new Date('2026-09-08T09:30:00Z'),
    endedAt: new Date('2026-09-08T09:50:00Z'),
    technicians: [1, 2],
    clientOffsetMs: 0,
    timestampSource: 'device',
  }

  it('defaults minTechnicians to 2 for checks and 1 for callbacks', () => {
    expect(settings.minTechnicians).toEqual({
      functional_check: 2,
      technical_maintenance: 2,
      repair: 2,
      callback: 1,
      other: 1,
    })
    expect(qualityFlags(base, settings, now)).toEqual([])
    expect(qualityFlags({ ...base, technicians: [1] }, settings, now)).toEqual(['singleTechnician'])
    expect(qualityFlags({ ...base, kind: 'callback', technicians: [1] }, settings, now)).toEqual([])
    const lenient = { minTechnicians: { ...settings.minTechnicians, functional_check: 1 } }
    expect(qualityFlags({ ...base, technicians: [1] }, lenient, now)).toEqual([])
  })

  it('flags endBeforeStart', () => {
    expect(
      qualityFlags({ ...base, endedAt: new Date('2026-09-08T09:00:00Z') }, settings, now),
    ).toEqual(['endBeforeStart'])
  })

  it('flags clockSuspect for a device offset > 2 min or a timestamp > 5 min ahead of receipt', () => {
    expect(qualityFlags({ ...base, clientOffsetMs: 119_000 }, settings, now)).toEqual([])
    expect(qualityFlags({ ...base, clientOffsetMs: -121_000 }, settings, now)).toEqual([
      'clockSuspect',
    ])
    expect(
      qualityFlags({ ...base, endedAt: new Date('2026-09-08T10:06:00Z') }, settings, now),
    ).toEqual(['clockSuspect'])
    // Office / paper entries have no device clock to distrust.
    expect(
      qualityFlags({ ...base, timestampSource: 'server', clientOffsetMs: 600_000 }, settings, now),
    ).toEqual([])
  })

  it('shares the rule with callback events', () => {
    expect(clockSuspect(now, now, 0)).toBe(false)
    expect(clockSuspect(new Date(now.getTime() + 5 * 60_000 + 1), now, 0)).toBe(true)
    expect(clockFlags(now, now, 200_000)).toEqual(['clockSuspect'])
    expect(clockFlags(now, now, undefined)).toEqual([])
  })
})

describe('signed file URLs', () => {
  const id = '019930a0-0000-7000-8000-000000000001'
  const tenant = '019930a0-0000-7000-8000-0000000000aa'
  const other = '019930a0-0000-7000-8000-0000000000bb'
  const now = new Date('2026-09-08T10:00:00Z')
  const exp = Math.floor(now.getTime() / 1000) + 600

  it('verifies a fresh signature for the right tenant and variant only', () => {
    const sig = signFile(id, 'thumb', exp, tenant, 'secret')
    expect(verifyFileSignature(id, 'thumb', exp, tenant, sig, now, 'secret')).toBe(true)
    expect(verifyFileSignature(id, 'full', exp, tenant, sig, now, 'secret')).toBe(false)
    expect(verifyFileSignature(id, 'thumb', exp, other, sig, now, 'secret')).toBe(false)
    expect(verifyFileSignature(id, 'thumb', exp + 1, tenant, sig, now, 'secret')).toBe(false)
    expect(verifyFileSignature(id, 'thumb', exp, tenant, sig, now, 'other-secret')).toBe(false)
    expect(
      verifyFileSignature(id, 'thumb', exp, tenant, sig.slice(0, 63) + '0', now, 'secret'),
    ).toBe(false)
  })

  it('rejects an expired signature', () => {
    const sig = signFile(id, 'full', exp, tenant, 'secret')
    const later = new Date(now.getTime() + 601_000)
    expect(verifyFileSignature(id, 'full', exp, tenant, sig, later, 'secret')).toBe(false)
  })

  it('builds a relative URL valid for 15 minutes', () => {
    const url = signedFileUrl(id, 'thumb', tenant)
    expect(url.startsWith(`/files/${id}?v=thumb&exp=`)).toBe(true)
    const q = new URL(url, 'http://x').searchParams
    const e = Number(q.get('exp'))
    expect(e * 1000 - Date.now()).toBeGreaterThan(14 * 60_000)
    expect(e * 1000 - Date.now()).toBeLessThanOrEqual(15 * 60_000)
    expect(q.get('sig')).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('idempotency request hash', () => {
  it('is independent of key order and undefined values', () => {
    expect(canonical({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe('{"a":[1,{"c":3,"d":2}],"b":1}')
    expect(requestHash({ a: 1, b: 2 })).toBe(requestHash({ b: 2, a: 1 }))
    expect(requestHash({ a: 1, b: undefined })).toBe(requestHash({ a: 1 }))
    expect(requestHash({ a: 1 })).not.toBe(requestHash({ a: 2 }))
  })
})

describe('sync push item schema', () => {
  it('accepts a visit.record with checklist and attachments, defaults schemaVersion', () => {
    const parsed = syncPushItem.parse({
      id: '019930a0-0000-7000-8000-000000000002',
      kind: 'visit.record',
      payload: {
        id: '019930a0-0000-7000-8000-000000000003',
        elevatorId: '019930a0-0000-7000-8000-000000000004',
        startedAt: '2026-09-08T09:00:00+03:00',
        technicians: [{ userId: '019930a0-0000-7000-8000-000000000005' }],
        source: 'app',
        timestampSource: 'device',
        clientOffsetMs: 1200,
        checklist: {
          templateKey: 'functional_check',
          templateVersion: 1,
          items: [{ code: 'A1', result: 'ok' }],
        },
        attachments: [{ id: '019930a0-0000-7000-8000-000000000006', role: 'logbook_page' }],
      },
    })
    expect(parsed.schemaVersion).toBe(1)
    expect(parsed.kind).toBe('visit.record')
  })

  it('rejects unknown kinds and a future schema version', () => {
    expect(() =>
      syncPushItem.parse({ id: '019930a0-0000-7000-8000-000000000002', kind: 'nope', payload: {} }),
    ).toThrow()
    expect(() =>
      syncPushItem.parse({
        id: '019930a0-0000-7000-8000-000000000002',
        kind: 'callback.event',
        schemaVersion: 2,
        payload: {
          callbackId: '019930a0-0000-7000-8000-000000000009',
          type: 'on_site',
          at: '2026-09-08T09:00:00Z',
        },
      }),
    ).toThrow()
  })

  it('device session tokens keep the browser token shape', () => {
    expect(isTokenShapeValid('a'.repeat(43))).toBe(true)
  })
})
