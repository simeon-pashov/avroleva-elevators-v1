/** Geocoder port (ARCHITECTURE A1, D19). Adapters: platform/adapters/geocoder/. */
export interface GeocodeHit {
  lat: number
  lng: number
  /** 0..1 */
  confidence: number
  provider: string
}

export interface Geocoder {
  readonly name: string
  geocode(
    addressText: string,
    hints?: { city?: string; countryCode?: string },
  ): Promise<GeocodeHit | null>
}
