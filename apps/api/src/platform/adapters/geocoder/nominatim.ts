import type { GeocodeHit, Geocoder } from '../../ports/geocoder.js'

/** Bulgarian address normalisation for Nominatim (MVP-PLAN section 3). */
export function normalizeForNominatim(addressText: string): string {
  return addressText
    .replace(/\bвх\.?\s*[А-Яа-яA-Za-z0-9]+/gi, '') // entrance is not a geocodable unit
    .replace(/\bж\.?\s*к\.?\s*/gi, 'ж.к. ')
    .replace(/\bбл\.?\s*/gi, 'блок ')
    .replace(/\bул\.?\s*/gi, 'ул. ')
    .replace(/\bбул\.?\s*/gi, 'бул. ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/,\s*,/g, ',')
    .trim()
}

interface NominatimResult {
  lat: string
  lon: string
  importance?: number
  type?: string
}

export function createNominatimGeocoder(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Geocoder {
  return {
    name: 'nominatim',
    async geocode(addressText, hints): Promise<GeocodeHit | null> {
      const q = normalizeForNominatim(addressText)
      const params = new URLSearchParams({
        format: 'jsonv2',
        limit: '1',
        countrycodes: hints?.countryCode ?? 'bg',
        q,
      })
      const res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/search?${params.toString()}`, {
        headers: {
          'User-Agent': 'Avroleva/0.1 (elevator maintenance register; contact: office@avroleva.bg)',
          Accept: 'application/json',
        },
      })
      if (!res.ok) throw new Error(`nominatim ${res.status}`)
      const data = (await res.json()) as NominatimResult[]
      const hit = data[0]
      if (!hit) return null
      const importance = typeof hit.importance === 'number' ? hit.importance : 0.3
      // Nominatim importance is roughly 0..1; a building/house-number hit is more trustworthy than a street.
      const typeBonus =
        hit.type === 'house' || hit.type === 'building' || hit.type === 'residential' ? 0.2 : 0
      return {
        lat: Number(hit.lat),
        lng: Number(hit.lon),
        confidence: Math.max(0, Math.min(1, importance + typeBonus)),
        provider: 'nominatim',
      }
    },
  }
}
