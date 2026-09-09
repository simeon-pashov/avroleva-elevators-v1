/** Geocoder port (ARCHITECTURE A1, D19). Adapters: platform/adapters/geocoder/. */
export interface GeocodeHit {
  lat: number
  lng: number
  /** 0..1 */
  confidence: number
  provider: string
}

/** Address parts as the building form wants them (step 8 address search). */
export interface GeoAddressParts {
  city: string
  postcode?: string
  oblast?: string
  district?: string
  street?: string
  number?: string
  block?: string
  entrance?: string
}

export interface GeoSuggestion {
  label: string
  lat: number
  lng: number
  address: GeoAddressParts
  confidence: number
  provider: string
  kind: string | null
  /** Likely a block / street / quarter centre rather than the exact entrance. */
  approximate: boolean
}

export interface GeoSearchOptions {
  countryCode?: string
  /** Accept-Language of the labels; default bg. */
  language?: string
  /** Bias box [west, south, east, north] (the tenant's pins / the map centre); results are not bounded to it. */
  viewbox?: [number, number, number, number]
  limit?: number
}

export interface Geocoder {
  readonly name: string
  geocode(
    addressText: string,
    hints?: { city?: string; countryCode?: string },
  ): Promise<GeocodeHit | null>
  /** As-you-type suggestions (up to `limit`, default 8); an adapter without search returns []. */
  search(q: string, opts?: GeoSearchOptions): Promise<GeoSuggestion[]>
}
