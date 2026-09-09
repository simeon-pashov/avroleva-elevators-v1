import type { GeoJsonPolygon } from '@avroleva/contracts'

/**
 * Zones (Райони) as tenant data - pure assignment rules. A building lands in the first zone (by
 * position) whose polygon contains its pin, else in the first zone listing its district name,
 * else in the default zone ("Всички"). Nothing here touches the database.
 */
export interface ZoneLike {
  id: string
  polygon: GeoJsonPolygon | null
  districts: string[]
  position: number
  isDefault: boolean
  active: boolean
}

export interface ZoneAssignable {
  lat: number | null
  lng: number | null
  address: { district?: string | null } | null
}

/** Ray casting on the outer ring (holes are ignored). A point on a vertex counts as outside. */
export function pointInPolygon(lng: number, lat: number, polygon: GeoJsonPolygon): boolean {
  const ring = polygon.coordinates[0]
  if (!ring || ring.length < 3) return false
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!
    const [xj, yj] = ring[j]!
    const crosses = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    if (crosses) inside = !inside
  }
  return inside
}

/** "ж.к. Младост 1", "жк Младост 1", "кв. Лозенец" -> "младост 1" / "лозенец" (case-folded). */
const DISTRICT_PREFIX = /^(?:ж\.?\s*к\.?\s*|кв\.\s*|кв\s+)/iu

export function normalizeDistrict(s: string | null | undefined): string {
  if (!s) return ''
  return s.trim().replace(DISTRICT_PREFIX, '').replace(/\s+/g, ' ').trim().toLowerCase()
}

/** Zone id for a building, or null when the tenant has no zone at all (no default yet). */
export function assignZone(building: ZoneAssignable, zones: ZoneLike[]): string | null {
  const live = zones
    .filter((z) => z.active)
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
  if (building.lat != null && building.lng != null) {
    for (const z of live) {
      if (z.isDefault || !z.polygon) continue
      if (pointInPolygon(building.lng, building.lat, z.polygon)) return z.id
    }
  }
  const district = normalizeDistrict(building.address?.district)
  if (district) {
    for (const z of live) {
      if (z.isDefault) continue
      if (z.districts.some((d) => normalizeDistrict(d) === district)) return z.id
    }
  }
  return live.find((z) => z.isDefault)?.id ?? null
}
