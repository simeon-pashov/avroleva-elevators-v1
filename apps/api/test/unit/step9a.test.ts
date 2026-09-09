import { describe, expect, it } from 'vitest'
import type { GeoJsonPolygon, PlanStop } from '@avroleva/contracts'
import { assignZone, normalizeDistrict, pointInPolygon } from '../../src/modules/registry/index.js'
import type { ZoneLike } from '../../src/modules/registry/index.js'
import {
  chunkEvenly,
  estKm,
  etaSequence,
  legsKm,
  mergeRegeneration,
  orderNearestNeighbour,
  pairIndexForUsers,
  sofiaLocalToUtc,
  stopKey,
} from '../../src/modules/maintenance/index.js'

// ---- zones ------------------------------------------------------------------------------------------

/** A square around ж.к. Младост (lng 23.36..23.40, lat 42.63..42.67). */
const SQUARE: GeoJsonPolygon = {
  type: 'Polygon',
  coordinates: [
    [
      [23.36, 42.63],
      [23.4, 42.63],
      [23.4, 42.67],
      [23.36, 42.67],
      [23.36, 42.63],
    ],
  ],
}

/** A concave "C" shape: the square with a bite taken out of its right side. */
const CONCAVE: GeoJsonPolygon = {
  type: 'Polygon',
  coordinates: [
    [
      [23.36, 42.63],
      [23.4, 42.63],
      [23.4, 42.645],
      [23.375, 42.645],
      [23.375, 42.655],
      [23.4, 42.655],
      [23.4, 42.67],
      [23.36, 42.67],
      [23.36, 42.63],
    ],
  ],
}

/** The square with a hole in the middle; holes are ignored by design (first ring only). */
const WITH_HOLE: GeoJsonPolygon = {
  type: 'Polygon',
  coordinates: [
    SQUARE.coordinates[0]!,
    [
      [23.37, 42.64],
      [23.39, 42.64],
      [23.39, 42.66],
      [23.37, 42.66],
      [23.37, 42.64],
    ],
  ],
}

const zone = (id: string, over: Partial<ZoneLike> = {}): ZoneLike => ({
  id,
  polygon: null,
  districts: [],
  position: 0,
  isDefault: false,
  active: true,
  ...over,
})

describe('zones: point in polygon', () => {
  it('inside, outside and on a concave polygon', () => {
    expect(pointInPolygon(23.38, 42.65, SQUARE)).toBe(true)
    expect(pointInPolygon(23.41, 42.65, SQUARE)).toBe(false)
    expect(pointInPolygon(23.38, 42.62, SQUARE)).toBe(false)
    // The bite of the C is outside; the arms are inside.
    expect(pointInPolygon(23.39, 42.65, CONCAVE)).toBe(false)
    expect(pointInPolygon(23.39, 42.64, CONCAVE)).toBe(true)
    expect(pointInPolygon(23.39, 42.66, CONCAVE)).toBe(true)
    expect(pointInPolygon(23.365, 42.65, CONCAVE)).toBe(true)
  })

  it('ignores holes (outer ring only)', () => {
    expect(pointInPolygon(23.38, 42.65, WITH_HOLE)).toBe(true)
  })

  it('a degenerate ring never matches', () => {
    expect(
      pointInPolygon(23.38, 42.65, {
        type: 'Polygon',
        coordinates: [
          [
            [23.36, 42.63],
            [23.4, 42.63],
          ],
        ],
      } as GeoJsonPolygon),
    ).toBe(false)
  })
})

describe('zones: district matching and assignment', () => {
  it('normalises the ж.к. / кв. prefixes, spacing and case', () => {
    expect(normalizeDistrict('ж.к. Младост 1')).toBe('младост 1')
    expect(normalizeDistrict('ЖК  Младост 1 ')).toBe('младост 1')
    expect(normalizeDistrict('ж.к.Младост 1')).toBe('младост 1')
    expect(normalizeDistrict('кв. Лозенец')).toBe('лозенец')
    expect(normalizeDistrict('кв Лозенец')).toBe('лозенец')
    expect(normalizeDistrict('Квартал Х')).toBe('квартал х')
    expect(normalizeDistrict(null)).toBe('')
  })

  const dflt = zone('default', { isDefault: true, position: 1000 })
  const poly = zone('poly', { polygon: SQUARE, position: 0 })
  const byDistrict = zone('district', { districts: ['Младост 1', 'кв. Дружба'], position: 1 })

  it('polygon first, then district (prefix-insensitive), else the default zone', () => {
    const zones = [dflt, byDistrict, poly]
    expect(
      assignZone({ lat: 42.65, lng: 23.38, address: { district: 'ж.к. Дружба' } }, zones),
    ).toBe('poly')
    expect(
      assignZone({ lat: 42.7, lng: 23.3, address: { district: 'ж.к. Младост 1' } }, zones),
    ).toBe('district')
    expect(assignZone({ lat: null, lng: null, address: { district: 'дружба' } }, zones)).toBe(
      'district',
    )
    expect(assignZone({ lat: 42.7, lng: 23.3, address: { district: 'Люлин' } }, zones)).toBe(
      'default',
    )
    expect(assignZone({ lat: null, lng: null, address: null }, zones)).toBe('default')
  })

  it('position decides between two matching zones; inactive zones never match', () => {
    const a = zone('a', { polygon: SQUARE, position: 5 })
    const b = zone('b', { polygon: SQUARE, position: 2 })
    expect(assignZone({ lat: 42.65, lng: 23.38, address: null }, [dflt, a, b])).toBe('b')
    expect(
      assignZone({ lat: 42.65, lng: 23.38, address: null }, [dflt, a, { ...b, active: false }]),
    ).toBe('a')
  })

  it('no zones at all -> null (the default is created lazily by the service)', () => {
    expect(assignZone({ lat: 42.65, lng: 23.38, address: null }, [])).toBeNull()
  })
})

// ---- routing ------------------------------------------------------------------------------------------

const BASE = { lat: 42.6605, lng: 23.3746 }
const STOPS = [
  { key: 'far', lat: 42.72, lng: 23.26 },
  { key: 'near', lat: 42.662, lng: 23.376 },
  { key: 'mid', lat: 42.69, lng: 23.32 },
  { key: 'nowhere', lat: null, lng: null },
]

describe('day plan: nearest-neighbour order', () => {
  it('walks from the base to the nearest unvisited stop; unlocated stops go last', () => {
    expect(orderNearestNeighbour(BASE, STOPS)).toEqual(['near', 'mid', 'far', 'nowhere'])
  })

  it('is deterministic: same input twice -> same output; ties break on the key', () => {
    const twice = [orderNearestNeighbour(BASE, STOPS), orderNearestNeighbour(BASE, STOPS)]
    expect(twice[0]).toEqual(twice[1])
    const tied = [
      { key: 'b', lat: 42.7, lng: 23.3 },
      { key: 'a', lat: 42.7, lng: 23.3 },
      { key: 'c', lat: 42.7, lng: 23.3 },
    ]
    expect(orderNearestNeighbour(BASE, tied)).toEqual(['a', 'b', 'c'])
    expect(orderNearestNeighbour(BASE, [...tied].reverse())).toEqual(['a', 'b', 'c'])
  })

  it('without a base the first located stop is the start', () => {
    expect(orderNearestNeighbour(null, STOPS)).toEqual(['far', 'mid', 'near', 'nowhere'])
    expect(orderNearestNeighbour(null, [])).toEqual([])
    expect(orderNearestNeighbour(null, [STOPS[3]!])).toEqual(['nowhere'])
  })
})

describe('day plan: legs, estKm and the ETA sequence', () => {
  it('sums straight-line legs from the base; unlocated stops add 0 km', () => {
    const ordered = ['near', 'mid', 'far', 'nowhere'].map((k) => STOPS.find((s) => s.key === k)!)
    const legs = legsKm(BASE, ordered)
    expect(legs).toHaveLength(4)
    expect(legs[0]).toBeGreaterThan(0.1)
    expect(legs[0]).toBeLessThan(0.3)
    expect(legs[3]).toBe(0)
    const total = estKm(legs)
    expect(total).toBeGreaterThan(9)
    expect(total).toBeLessThan(13)
    expect(estKm([])).toBe(0)
    expect(legsKm(null, ordered)[0]).toBe(0)
  })

  it('converts a Sofia wall-clock time to UTC across DST', () => {
    expect(sofiaLocalToUtc('2026-09-15', '08:30').toISOString()).toBe('2026-09-15T05:30:00.000Z')
    expect(sofiaLocalToUtc('2026-01-15', '08:30').toISOString()).toBe('2026-01-15T06:30:00.000Z')
  })

  it('ETA = day start + legs at the average speed + the time spent at the previous stops', () => {
    // 25 km/h: 5 km = 12 min; 25 min per stop.
    const etas = etaSequence('2026-09-15', '08:30', [5, 5, 0], 25, 25)
    expect(etas).toEqual([
      '2026-09-15T05:42:00.000Z',
      '2026-09-15T06:19:00.000Z',
      '2026-09-15T06:44:00.000Z',
    ])
    expect(etaSequence('2026-09-15', '08:30', [], 25, 25)).toEqual([])
  })
})

// ---- merge rules --------------------------------------------------------------------------------------

const stop = (id: string, refId: string, over: Partial<PlanStop> = {}): PlanStop => ({
  id,
  kind: 'check',
  refId,
  elevatorId: refId,
  buildingId: 'b-' + refId,
  order: 0,
  plannedAt: null,
  status: 'planned',
  completedAt: null,
  manual: false,
  notes: null,
  ...over,
})

describe('day plan: mergeRegeneration', () => {
  const existing = [
    stop('s1', 'e1', { status: 'done', order: 0 }),
    stop('s2', 'e2', { order: 1 }),
    stop('s3', 'e3', { manual: true, order: 2, notes: 'ключът е при касиера' }),
    stop('s4', 'e4', { order: 3 }),
  ]
  const candidates = [stop('c9', 'e9'), stop('c2', 'e2'), stop('c5', 'e5'), stop('c1', 'e1')]

  it('locked: returns the existing list unchanged (nothing added, nothing removed)', () => {
    const out = mergeRegeneration(existing, true, candidates)
    expect(out.map((s) => s.id)).toEqual(['s1', 's2', 's3', 's4'])
    expect(out[2]!.notes).toBe('ключът е при касиера')
    expect(out).not.toBe(existing)
  })

  it('unlocked: keeps done / manual stops at their place, replaces the planned ones, dedupes', () => {
    const out = mergeRegeneration(existing, false, candidates)
    // s1 (done) at 0, s3 (manual) at 2; planned slots filled with the candidates in order;
    // e1 is dropped (already kept as s1), e2 keeps its existing id s2, e4 is gone.
    expect(out.map((s) => stopKey(s))).toEqual([
      'check:e1',
      'check:e9',
      'check:e3',
      'check:e2',
      'check:e5',
    ])
    expect(out.map((s) => s.id)).toEqual(['s1', 'c9', 's3', 's2', 'c5'])
    expect(out.map((s) => s.order)).toEqual([0, 1, 2, 3, 4])
    expect(out[0]!.status).toBe('done')
  })

  it('no existing plan: the candidates, deduped and renumbered', () => {
    const out = mergeRegeneration(null, false, [...candidates, stop('dup', 'e9')])
    expect(out.map((s) => s.refId)).toEqual(['e9', 'e2', 'e5', 'e1'])
    expect(out.map((s) => s.order)).toEqual([0, 1, 2, 3])
    expect(mergeRegeneration([], false, [])).toEqual([])
  })

  it('chunks evenly and finds the pair of an assigned technician', () => {
    expect(chunkEvenly([1, 2, 3, 4, 5], 2)).toEqual([
      [1, 2, 3],
      [4, 5],
    ])
    expect(chunkEvenly([1], 3)).toEqual([[1], [], []])
    expect(chunkEvenly([], 2)).toEqual([[], []])
    const pairs = [{ userIds: ['u1', 'u2'] }, { userIds: ['u3'] }]
    expect(pairIndexForUsers(pairs, ['u3'])).toBe(1)
    expect(pairIndexForUsers(pairs, ['u9', 'u2'])).toBe(0)
    expect(pairIndexForUsers(pairs, [])).toBe(-1)
    expect(pairIndexForUsers(pairs, ['u9'])).toBe(-1)
  })
})
