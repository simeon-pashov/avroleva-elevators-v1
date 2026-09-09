import type {
  BuildingWithElevatorResultDto,
  CreateBuildingWithElevatorBody,
  GeoSearchQuery,
  GeoSuggestionDto,
  NearbyBuildingDto,
  NearbyBuildingsQuery,
} from '@avroleva/contracts'
import type { Ctx } from '../../../platform/http/ctx.js'
import { actorOf } from '../../../platform/http/ctx.js'
import { AppError, notFound } from '../../../platform/http/errors.js'
import { audit } from '../../../platform/audit.js'
import { adapters } from '../../../platform/adapters/index.js'
import { logger } from '../../../platform/logger.js'
import * as buildingsRepo from '../repo/buildings.js'
import * as customersRepo from '../repo/customers.js'
import * as elevators from './elevators.js'
import { resolveZoneFor } from './zones.js'
import { toBuildingDto } from '../domain/mappers.js'
import { buildAddressText } from '../domain/address.js'
import { viewboxFor, withinRadius } from '../domain/geo.js'

/**
 * Address search (step 8): suggestions through the Geocoder port, biased to the map centre or
 * the tenant's pins. The adapter throttles and caches; the client debounces.
 */
export async function searchAddress(ctx: Ctx, q: GeoSearchQuery): Promise<GeoSuggestionDto[]> {
  const point = q.lat != null && q.lng != null ? { lat: q.lat, lng: q.lng } : null
  const pins = point ? [] : await buildingsRepo.buildingPins(ctx.tenantId)
  const viewbox = viewboxFor(
    point,
    pins.map((p) => ({ lat: p.lat!, lng: p.lng! })),
  )
  try {
    const items = await adapters.geocoder.search(q.q, {
      countryCode: 'bg',
      language: ctx.locale === 'en' ? 'bg,en' : 'bg',
      viewbox,
      limit: 8,
    })
    return items.slice(0, 8).map((s) => ({
      label: s.label,
      lat: s.lat,
      lng: s.lng,
      address: s.address,
      confidence: s.confidence,
      provider: s.provider,
      kind: s.kind,
      approximate: s.approximate,
    }))
  } catch (err) {
    logger.warn({ err, q: q.q }, 'address search failed')
    throw new AppError(502, 'buildings.geocodeUnavailable')
  }
}

/** Existing buildings within `radiusM` of a point (so a second entrance attaches instead of duplicating). */
export async function nearby(ctx: Ctx, q: NearbyBuildingsQuery): Promise<NearbyBuildingDto[]> {
  const pins = await buildingsRepo.buildingPins(ctx.tenantId)
  return withinRadius(
    { lat: q.lat, lng: q.lng },
    pins.map((p) => ({
      id: p.id,
      addressText: p.addressText,
      customerName: p.customer?.name ?? null,
      lat: p.lat!,
      lng: p.lng!,
      elevatorCount: p._count.elevators,
    })),
    q.radiusM,
  ).slice(0, 10)
}

/**
 * "Добави асансьор тук": the building from the dropped pin (geocode status `manual`) and the
 * elevator in one call, optionally a new customer. With `buildingId` the elevator is attached to
 * an existing building instead. The building is created first; the elevator goes through the
 * registry's own command so the schedule, audit and ElevatorRegistered happen as usual.
 */
export async function createWithElevator(
  ctx: Ctx,
  body: CreateBuildingWithElevatorBody,
): Promise<BuildingWithElevatorResultDto> {
  let customerId = body.customerId ?? null
  let customerCreated = false
  if (body.newCustomer) {
    const c = await customersRepo.createCustomer(ctx.tenantId, {
      name: body.newCustomer.name,
      kind: body.newCustomer.kind,
      createdBy: ctx.userId,
    })
    customerId = c.id
    customerCreated = true
    await audit(actorOf(ctx), {
      action: 'customer.create',
      entityType: 'customer',
      entityId: c.id,
      after: { name: c.name, via: 'add-elevator-here' },
    })
  } else if (customerId && !(await customersRepo.findCustomer(ctx.tenantId, customerId))) {
    throw notFound()
  }

  let building
  let buildingCreated = false
  if (body.buildingId) {
    building = await buildingsRepo.findBuilding(ctx.tenantId, body.buildingId)
    if (!building) throw notFound()
  } else {
    if (!body.building) throw new AppError(400, 'buildings.addressRequired')
    const b = body.building
    building = await buildingsRepo.createBuilding(ctx.tenantId, {
      customerId,
      address: b.address,
      addressText: b.addressText ?? buildAddressText(b.address),
      lat: b.lat,
      lng: b.lng,
      geocodeStatus: 'manual',
      geocodeProvider: 'manual',
      accessNotes: b.accessNotes ?? null,
      notes: b.notes ?? null,
      zoneId: await resolveZoneFor(ctx.tenantId, { lat: b.lat, lng: b.lng, address: b.address }),
      createdBy: ctx.userId,
    })
    buildingCreated = true
    await audit(actorOf(ctx), {
      action: 'building.create',
      entityType: 'building',
      entityId: building.id,
      after: {
        addressText: building.addressText,
        lat: building.lat,
        lng: building.lng,
        via: 'map',
      },
    })
  }
  const elevator = await elevators.create(ctx, { ...body.elevator, buildingId: building.id })
  const fresh = await buildingsRepo.findBuilding(ctx.tenantId, building.id)
  return {
    building: toBuildingDto(fresh ?? building),
    elevator,
    created: { building: buildingCreated, customer: customerCreated },
  }
}
