/** Small geo helpers (pure): distances on the earth's surface and bias boxes for the search. */
const EARTH_RADIUS_M = 6_371_000

/** Great-circle distance in metres (haversine). */
export function distanceMetres(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Points within `radiusM` of `centre`, nearest first, with the distance attached. */
export function withinRadius<T extends { lat: number; lng: number }>(
  centre: { lat: number; lng: number },
  points: T[],
  radiusM: number,
): Array<T & { distanceM: number }> {
  return points
    .map((p) => ({ ...p, distanceM: Math.round(distanceMetres(centre, p)) }))
    .filter((p) => p.distanceM <= radiusM)
    .sort((a, b) => a.distanceM - b.distanceM)
}

/** Sofia, when a tenant has no pins yet. */
export const SOFIA_VIEWBOX: [number, number, number, number] = [23.2, 42.6, 23.45, 42.78]

/**
 * Bias box [west, south, east, north] for the address search: around an explicit point (about
 * 5 km), else the bounding box of the tenant's pins (padded), else Sofia.
 */
export function viewboxFor(
  point: { lat: number; lng: number } | null,
  pins: Array<{ lat: number; lng: number }>,
): [number, number, number, number] {
  const r = (n: number) => Math.round(n * 1e4) / 1e4
  if (point)
    return [r(point.lng - 0.05), r(point.lat - 0.04), r(point.lng + 0.05), r(point.lat + 0.04)]
  if (pins.length === 0) return SOFIA_VIEWBOX
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity
  for (const p of pins) {
    west = Math.min(west, p.lng)
    east = Math.max(east, p.lng)
    south = Math.min(south, p.lat)
    north = Math.max(north, p.lat)
  }
  const padLng = Math.max(0.02, (east - west) * 0.2)
  const padLat = Math.max(0.02, (north - south) * 0.2)
  return [r(west - padLng), r(south - padLat), r(east + padLng), r(north + padLat)]
}
