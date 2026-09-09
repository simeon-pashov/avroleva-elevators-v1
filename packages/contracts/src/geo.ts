import { z } from 'zod'
import { address, createElevatorBody, lat, lng } from './registry.js'
import type { Address, BuildingDto, ElevatorDto } from './registry.js'
import { CustomerKind } from './enums.js'
import { nullableText, optionalText, uuid } from './common.js'

/**
 * Address search (step 8): as-you-type suggestions through the Geocoder port
 * (Nominatim adapter, `countrycodes=bg`, Bulgarian labels, viewbox bias to the tenant's pins).
 */
export const geoSearchQuery = z.object({
  q: z.string().trim().min(2).max(200),
  /** Bias point (the map centre); the tenant's pins are used when absent. */
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
})
export type GeoSearchQuery = z.infer<typeof geoSearchQuery>

export interface GeoSuggestionDto {
  /** One-line label in Bulgarian (what the user sees in the list). */
  label: string
  lat: number
  lng: number
  /** Address parts parsed for the building form; missing parts are undefined. */
  address: Partial<Address> & { city: string }
  /** 0..1 */
  confidence: number
  provider: string
  /** house | building | residential | road | quarter | ... (provider's class/type, informational). */
  kind: string | null
  /** True when the point is likely a block / street centre, not the exact entrance (drag to fix). */
  approximate: boolean
}

export const nearbyBuildingsQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  /** Metres; default 60. */
  radiusM: z.coerce.number().int().min(5).max(1000).default(60),
})
export type NearbyBuildingsQuery = z.infer<typeof nearbyBuildingsQuery>

export interface NearbyBuildingDto {
  id: string
  addressText: string
  customerName: string | null
  lat: number
  lng: number
  elevatorCount: number
  distanceM: number
}

/**
 * "Добави асансьор тук": creates the building (with the dropped pin, geocode status manual) and
 * the elevator in one call; or attaches the elevator to an existing building nearby.
 */
export const createBuildingWithElevatorBody = z.object({
  /** Attach to this building instead of creating one. */
  buildingId: uuid.optional(),
  building: z
    .object({
      address,
      addressText: optionalText(500),
      lat,
      lng,
      accessNotes: nullableText(2000),
      notes: nullableText(4000),
    })
    .optional(),
  customerId: uuid.nullable().optional(),
  /** Create the customer on the fly (wins over customerId). */
  newCustomer: z
    .object({
      name: z.string().trim().min(2).max(200),
      kind: CustomerKind.default('etazhna_sobstvenost'),
    })
    .optional(),
  elevator: createElevatorBody.omit({ buildingId: true }),
})
export type CreateBuildingWithElevatorBody = z.infer<typeof createBuildingWithElevatorBody>

export interface BuildingWithElevatorResultDto {
  building: BuildingDto
  elevator: ElevatorDto
  created: { building: boolean; customer: boolean }
}
