import type { GeocodeHit, Geocoder } from '../../ports/geocoder.js'

/** Deterministic stub for tests and demos: Sofia centre, nudged by a hash of the address. */
export function createStubGeocoder(): Geocoder {
  return {
    name: 'stub',
    async geocode(addressText): Promise<GeocodeHit | null> {
      if (/nowhere|никъде/i.test(addressText)) return null
      let h = 0
      for (const ch of addressText) h = (h * 31 + ch.charCodeAt(0)) % 100000
      return {
        lat: 42.6977 + (h % 1000) / 50000,
        lng: 23.3219 + ((h / 1000) % 100) / 5000,
        confidence: 0.5,
        provider: 'stub',
      }
    },
  }
}
