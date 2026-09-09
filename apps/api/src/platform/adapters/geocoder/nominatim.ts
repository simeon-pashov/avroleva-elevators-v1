import type {
  GeoAddressParts,
  GeoSearchOptions,
  GeoSuggestion,
  GeocodeHit,
  Geocoder,
} from '../../ports/geocoder.js'

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

export interface NominatimAddress {
  house_number?: string
  road?: string
  pedestrian?: string
  residential?: string
  neighbourhood?: string
  quarter?: string
  suburb?: string
  city_district?: string
  city?: string
  town?: string
  village?: string
  municipality?: string
  county?: string
  state?: string
  postcode?: string
  building?: string
  country_code?: string
}

export interface NominatimResult {
  lat: string
  lon: string
  importance?: number
  class?: string
  type?: string
  display_name?: string
  name?: string
  address?: NominatimAddress
}

const APPROXIMATE_TYPES = new Set([
  'road',
  'residential',
  'pedestrian',
  'living_street',
  'quarter',
  'suburb',
  'neighbourhood',
  'city_district',
  'city',
  'town',
  'village',
  'administrative',
])

function blockFrom(v: string | undefined): string | undefined {
  if (!v) return undefined
  const m = v.match(/(?:бл(?:ок)?\.?\s*)([0-9A-Za-zА-Яа-я-]+)/i)
  return m ? m[1] : undefined
}

/**
 * Nominatim `addressdetails=1` -> the building form's parts. Bulgarian specifics: a panel-block
 * quarter arrives as `suburb` / `quarter` / `neighbourhood` ("ж.к. Младост 1"); the block number
 * is the `building` / `name` ("бл. 25") or, in a quarter without a street, the `house_number`;
 * a `road` is the street. Nominatim often answers "ж.к. X бл. N" with the block's centre - the
 * UI says so and lets the pin be dragged.
 */
export function parseNominatimAddress(r: NominatimResult): GeoAddressParts {
  const a = r.address ?? {}
  const city = a.city ?? a.town ?? a.village ?? a.municipality ?? ''
  const district = a.suburb ?? a.quarter ?? a.neighbourhood ?? a.city_district ?? a.residential
  const street = a.road ?? a.pedestrian
  let block = blockFrom(a.building) ?? blockFrom(r.name) ?? blockFrom(r.display_name)
  let number = a.house_number
  if (!block && number && district && !street && /^\d+[A-Za-zА-Яа-я]?$/.test(number)) {
    block = number
    number = undefined
  }
  const entranceMatch = (r.name ?? '').match(/вх\.?\s*([А-Яа-яA-Za-z0-9]{1,3})/i)
  const out: GeoAddressParts = { city }
  if (a.postcode) out.postcode = a.postcode
  if (a.state) out.oblast = a.state
  if (district) out.district = district
  if (street) out.street = street
  if (number) out.number = number
  if (block) out.block = block
  if (entranceMatch) out.entrance = entranceMatch[1]
  return out
}

/** Short Bulgarian label: "ж.к. Младост 1, бл. 25, София" instead of the 9-part display_name. */
export function labelFor(parts: GeoAddressParts, fallback: string): string {
  const bits: string[] = []
  if (parts.district) bits.push(parts.district)
  if (parts.street) bits.push(parts.number ? `${parts.street} ${parts.number}` : parts.street)
  if (parts.block) bits.push(`бл. ${parts.block}`)
  if (parts.entrance) bits.push(`вх. ${parts.entrance}`)
  if (parts.city) bits.push(parts.city)
  return bits.length ? bits.join(', ') : fallback
}

export function toSuggestion(r: NominatimResult): GeoSuggestion {
  const parts = parseNominatimAddress(r)
  const importance = typeof r.importance === 'number' ? r.importance : 0.3
  const exact = r.type === 'house' || r.type === 'building' || r.type === 'apartments'
  const kind = r.type ?? r.class ?? null
  return {
    label: labelFor(parts, r.display_name ?? ''),
    lat: Number(r.lat),
    lng: Number(r.lon),
    address: parts,
    confidence: Math.max(0, Math.min(1, importance + (exact ? 0.2 : 0))),
    provider: 'nominatim',
    kind,
    // A block hit is the block's centre, never the entrance: always "drag to fix".
    approximate: !!parts.block || (!exact && (kind == null || APPROXIMATE_TYPES.has(kind))),
  }
}

const CACHE_TTL_MS = 10 * 60_000
const CACHE_MAX = 300
const MIN_INTERVAL_MS = 1000

/**
 * Nominatim adapter: `geocode` (one hit) and `search` (suggestions). Nominatim's usage policy is
 * one request per second per application: every call goes through one queue that spaces the
 * requests, and a small in-memory cache answers repeated queries (the typing debounce is in the
 * client). `fetchImpl` is injectable for tests.
 */
export function createNominatimGeocoder(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
  opts: { minIntervalMs?: number; now?: () => number } = {},
): Geocoder {
  const minInterval = opts.minIntervalMs ?? MIN_INTERVAL_MS
  const now = opts.now ?? Date.now
  const cache = new Map<string, { at: number; value: unknown }>()
  let chain: Promise<unknown> = Promise.resolve()
  let lastAt = 0

  const throttled = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(async () => {
      const wait = lastAt + minInterval - now()
      if (wait > 0) await new Promise((r) => setTimeout(r, wait))
      lastAt = now()
      return fn()
    })
    chain = run.catch(() => undefined)
    return run
  }

  const cached = async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    const hit = cache.get(key)
    if (hit && now() - hit.at < CACHE_TTL_MS) return hit.value as T
    const value = await throttled(fn)
    if (cache.size >= CACHE_MAX) {
      const oldest = cache.keys().next().value
      if (oldest !== undefined) cache.delete(oldest)
    }
    cache.set(key, { at: now(), value })
    return value
  }

  const request = async (params: URLSearchParams, language: string) => {
    const res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/search?${params.toString()}`, {
      headers: {
        'User-Agent': 'Avroleva/0.1 (elevator maintenance register; contact: office@avroleva.bg)',
        Accept: 'application/json',
        'Accept-Language': language,
      },
    })
    if (!res.ok) throw new Error(`nominatim ${res.status}`)
    return (await res.json()) as NominatimResult[]
  }

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
      const data = await cached(`g:${params.toString()}`, () => request(params, 'bg'))
      const hit = data[0]
      if (!hit) return null
      const s = toSuggestion(hit)
      return { lat: s.lat, lng: s.lng, confidence: s.confidence, provider: 'nominatim' }
    },
    async search(q, o: GeoSearchOptions = {}): Promise<GeoSuggestion[]> {
      const text = normalizeForNominatim(q)
      if (text.length < 2) return []
      const params = new URLSearchParams({
        format: 'jsonv2',
        addressdetails: '1',
        limit: String(o.limit ?? 8),
        countrycodes: o.countryCode ?? 'bg',
        'accept-language': o.language ?? 'bg',
        q: text,
      })
      if (o.viewbox) {
        params.set('viewbox', o.viewbox.map((n) => n.toFixed(4)).join(','))
        params.set('bounded', '0')
      }
      const data = await cached(`s:${params.toString()}`, () => request(params, o.language ?? 'bg'))
      return data.map(toSuggestion)
    },
  }
}
