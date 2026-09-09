import type { GeoSearchOptions, GeoSuggestion, GeocodeHit, Geocoder } from '../../ports/geocoder.js'

function hashOf(text: string): number {
  let h = 0
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) % 100000
  return h
}

/** Deterministic stub for tests and demos: Sofia centre, nudged by a hash of the address. */
export function createStubGeocoder(): Geocoder {
  return {
    name: 'stub',
    async geocode(addressText): Promise<GeocodeHit | null> {
      if (/nowhere|никъде/i.test(addressText)) return null
      const h = hashOf(addressText)
      return {
        lat: 42.6977 + (h % 1000) / 50000,
        lng: 23.3219 + ((h / 1000) % 100) / 5000,
        confidence: 0.5,
        provider: 'stub',
      }
    },
    /**
     * Three suggestions derived from the query: the block / house (exact-ish), the street and the
     * quarter (approximate). "nowhere" / "никъде" returns nothing.
     */
    async search(q, opts: GeoSearchOptions = {}): Promise<GeoSuggestion[]> {
      if (/nowhere|никъде/i.test(q) || q.trim().length < 2) return []
      const h = hashOf(q)
      const base = { lat: 42.6977 + (h % 1000) / 50000, lng: 23.3219 + ((h / 1000) % 100) / 5000 }
      const block = q.match(/бл\.?\s*(\d+)/i)?.[1]
      const number = q.match(/(?:^|\s)(\d+)\s*$/)?.[1]
      const district = q.match(/ж\.?\s*к\.?\s*([^,]+?)(?:,|\s+бл|$)/i)?.[1]?.trim()
      const street = q.match(/(?:ул\.?|бул\.?)\s*([^,\d]+)/i)?.[1]?.trim()
      const city = 'София'
      const districtLabel = district ? `ж.к. ${district}` : null
      const streetLabel = street ? `ул. ${street}` : null
      const first: GeoSuggestion = {
        label: [
          districtLabel ?? (streetLabel ? `${streetLabel} ${number ?? ''}`.trim() : q),
          block ? `бл. ${block}` : '',
          city,
        ]
          .filter(Boolean)
          .join(', '),
        ...base,
        address: {
          city,
          ...(districtLabel ? { district: districtLabel } : {}),
          ...(streetLabel ? { street: streetLabel } : {}),
          ...(number && !block ? { number } : {}),
          ...(block ? { block } : {}),
          postcode: '1000',
        },
        confidence: 0.8,
        provider: 'stub',
        kind: block || number ? 'building' : 'road',
        approximate: !!block,
      }
      const items: GeoSuggestion[] = [
        first,
        {
          label: `${streetLabel ?? 'ул. Тестова'}, ${city}`,
          lat: base.lat + 0.0008,
          lng: base.lng + 0.0008,
          address: { city, street: streetLabel ?? 'ул. Тестова' },
          confidence: 0.5,
          provider: 'stub',
          kind: 'road',
          approximate: true,
        },
        {
          label: `${districtLabel ?? 'ж.к. Младост 1'}, ${city}`,
          lat: base.lat + 0.002,
          lng: base.lng - 0.001,
          address: { city, district: districtLabel ?? 'ж.к. Младост 1' },
          confidence: 0.4,
          provider: 'stub',
          kind: 'suburb',
          approximate: true,
        },
      ]
      return items.slice(0, opts.limit ?? 8)
    },
  }
}
