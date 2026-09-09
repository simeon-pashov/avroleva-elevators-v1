import { distanceMetres } from '../../registry/index.js'

/**
 * Day-plan routing (step 9), pure and deterministic. No routing engine: stops are ordered
 * nearest-neighbour from the tenant's base (or the first stop), legs are straight-line
 * kilometres and the ETA is a plain sequence (day start + legs at the average speed + the
 * average time per stop). Good enough to hand a technician pair a sensible order; the office
 * drags what it knows better.
 */
export interface RoutePoint {
  lat: number
  lng: number
}

export interface RouteStop {
  key: string
  lat: number | null
  lng: number | null
}

const EPSILON_M = 1e-6

/**
 * Nearest-neighbour order of the stop keys from `start` (else from the first stop with
 * coordinates). Ties break on the key (stable, so the same input always yields the same
 * output); stops without coordinates go last in input order.
 */
export function orderNearestNeighbour(start: RoutePoint | null, stops: RouteStop[]): string[] {
  const located: Array<{ key: string; lat: number; lng: number }> = []
  const unlocated: string[] = []
  for (const s of stops) {
    if (s.lat != null && s.lng != null) located.push({ key: s.key, lat: s.lat, lng: s.lng })
    else unlocated.push(s.key)
  }
  const out: string[] = []
  const remaining = [...located]
  let current: RoutePoint | null = start
  if (!current && remaining.length > 0) {
    const first = remaining.shift()!
    out.push(first.key)
    current = first
  }
  while (remaining.length > 0) {
    let bestIdx = 0
    let bestD = Infinity
    for (let i = 0; i < remaining.length; i++) {
      const d = distanceMetres(current!, remaining[i]!)
      if (
        d < bestD - EPSILON_M ||
        (Math.abs(d - bestD) <= EPSILON_M && remaining[i]!.key < remaining[bestIdx]!.key)
      ) {
        bestD = d
        bestIdx = i
      }
    }
    const next = remaining.splice(bestIdx, 1)[0]!
    out.push(next.key)
    current = next
  }
  return [...out, ...unlocated]
}

/** Straight-line km from the previous located point (or the base) to each stop, in order. */
export function legsKm(start: RoutePoint | null, orderedStops: RouteStop[]): number[] {
  let prev: RoutePoint | null = start
  return orderedStops.map((s) => {
    if (s.lat == null || s.lng == null) return 0
    const here = { lat: s.lat, lng: s.lng }
    const km = prev ? distanceMetres(prev, here) / 1000 : 0
    prev = here
    return Math.round(km * 100) / 100
  })
}

export function estKm(legs: number[]): number {
  return Math.round(legs.reduce((s, k) => s + k, 0) * 10) / 10
}

/** Offset (ms) of Europe/Sofia from UTC at the given instant (+2 h winter, +3 h summer). */
export function sofiaOffsetMs(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Sofia',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  )
  return asUtc - Math.floor(at.getTime() / 1000) * 1000
}

/** The instant of `date` (YYYY-MM-DD) at `time` (HH:MM) on the office wall clock in Sofia. */
export function sofiaLocalToUtc(date: string, time: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const [h, min] = time.split(':').map(Number) as [number, number]
  const naive = Date.UTC(y, m - 1, d, h, min)
  const offset = sofiaOffsetMs(new Date(naive))
  let utc = naive - offset
  // One correction pass in case the first guess sat on the other side of a DST switch.
  const offset2 = sofiaOffsetMs(new Date(utc))
  if (offset2 !== offset) utc = naive - offset2
  return new Date(utc)
}

/**
 * ISO arrival time per stop: day start, then for every stop the leg at `avgSpeedKmh` plus
 * `avgStopMinutes` spent at the previous stop.
 */
export function etaSequence(
  date: string,
  dayStart: string,
  legs: number[],
  avgSpeedKmh: number,
  avgStopMinutes: number,
): string[] {
  let t = sofiaLocalToUtc(date, dayStart).getTime()
  const speed = Math.max(1, avgSpeedKmh)
  return legs.map((km, i) => {
    if (i > 0) t += avgStopMinutes * 60_000
    t += (km / speed) * 3_600_000
    return new Date(Math.round(t / 60_000) * 60_000).toISOString()
  })
}
