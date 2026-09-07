import type {
  BuildingDetailDto,
  BuildingDto,
  BuildingPinDto,
  CreateBuildingBody,
  GeocodeResultDto,
  Page,
  UpdateBuildingBody,
} from '@avroleva/contracts'
import type { Ctx } from '../../../platform/http/ctx.js'
import { actorOf } from '../../../platform/http/ctx.js'
import { AppError, notFound } from '../../../platform/http/errors.js'
import { toPage } from '../../../platform/http/pagination.js'
import { audit } from '../../../platform/audit.js'
import { clock } from '../../../platform/clock.js'
import { adapters } from '../../../platform/adapters/index.js'
import { logger } from '../../../platform/logger.js'
import { getTenantSettings } from '../../tenancy/index.js'
import * as repo from '../repo/buildings.js'
import * as customers from '../repo/customers.js'
import * as elevators from '../repo/elevators.js'
import * as contacts from '../repo/contacts.js'
import * as contracts from '../repo/contracts.js'
import { toBuildingDto, toContactDto, toContractDto, toElevatorDto } from '../domain/mappers.js'
import { buildAddressText } from '../domain/address.js'
import type { GeocodeStatus } from '../../../generated/prisma/index.js'

export async function list(
  ctx: Ctx,
  q: {
    cursor?: string
    limit: number
    q?: string
    customerId?: string
    geocodeStatus?: GeocodeStatus
  },
): Promise<Page<BuildingDto>> {
  return toPage(await repo.listBuildings(ctx.tenantId, q), q.limit, toBuildingDto)
}

export async function pins(ctx: Ctx): Promise<BuildingPinDto[]> {
  const rows = await repo.buildingPins(ctx.tenantId)
  return rows.map((r) => ({
    id: r.id,
    addressText: r.addressText,
    lat: r.lat!,
    lng: r.lng!,
    elevatorCount: r._count.elevators,
  }))
}

export async function get(ctx: Ctx, id: string): Promise<BuildingDetailDto> {
  const b = await repo.findBuilding(ctx.tenantId, id)
  if (!b) throw notFound()
  const [settings, els, cts, crs] = await Promise.all([
    getTenantSettings(ctx.tenantId),
    elevators.elevatorsForBuilding(ctx.tenantId, id),
    contacts.contactsForBuilding(ctx.tenantId, id),
    contracts.contractsForBuilding(ctx.tenantId, id),
  ])
  return {
    ...toBuildingDto(b),
    elevators: els.map((e) => toElevatorDto(e, settings)),
    contacts: cts.map(toContactDto),
    contracts: crs.map(toContractDto),
  }
}

export async function create(ctx: Ctx, body: CreateBuildingBody): Promise<BuildingDto> {
  if (body.customerId && !(await customers.findCustomer(ctx.tenantId, body.customerId)))
    throw notFound()
  const hasCoords = body.lat != null && body.lng != null
  const b = await repo.createBuilding(ctx.tenantId, {
    customerId: body.customerId ?? null,
    address: body.address,
    addressText: body.addressText ?? buildAddressText(body.address),
    lat: hasCoords ? body.lat : null,
    lng: hasCoords ? body.lng : null,
    geocodeStatus: hasCoords ? 'manual' : 'pending',
    accessNotes: body.accessNotes ?? null,
    keysLocation: body.keysLocation ?? null,
    notes: body.notes ?? null,
    createdBy: ctx.userId,
  })
  await audit(actorOf(ctx), {
    action: 'building.create',
    entityType: 'building',
    entityId: b.id,
    after: { addressText: b.addressText },
  })
  return toBuildingDto(b)
}

export async function update(ctx: Ctx, id: string, body: UpdateBuildingBody): Promise<BuildingDto> {
  const before = await repo.findBuilding(ctx.tenantId, id)
  if (!before) throw notFound()
  if (body.customerId && !(await customers.findCustomer(ctx.tenantId, body.customerId)))
    throw notFound()
  const address = body.address ?? (before.address as CreateBuildingBody['address'])
  const addressText =
    body.addressText ?? (body.address ? buildAddressText(body.address) : before.addressText)
  const coordsGiven = body.lat !== undefined || body.lng !== undefined
  const lat = body.lat !== undefined ? body.lat : before.lat
  const lng = body.lng !== undefined ? body.lng : before.lng
  const b = await repo.updateBuilding(ctx.tenantId, id, {
    ...(body.customerId !== undefined ? { customerId: body.customerId } : {}),
    address,
    addressText,
    ...(coordsGiven
      ? {
          lat,
          lng,
          geocodeStatus: lat != null && lng != null ? 'manual' : 'pending',
          geocodeProvider: 'manual',
          geocodeConfidence: null,
        }
      : {}),
    ...(body.accessNotes !== undefined ? { accessNotes: body.accessNotes } : {}),
    ...(body.keysLocation !== undefined ? { keysLocation: body.keysLocation } : {}),
    ...(body.notes !== undefined ? { notes: body.notes } : {}),
    updatedBy: ctx.userId,
  })
  await audit(actorOf(ctx), {
    action: 'building.update',
    entityType: 'building',
    entityId: id,
    before: { addressText: before.addressText, lat: before.lat, lng: before.lng },
    after: { addressText: b.addressText, lat: b.lat, lng: b.lng },
  })
  return toBuildingDto(b)
}

export async function setLocation(
  ctx: Ctx,
  id: string,
  lat: number,
  lng: number,
): Promise<BuildingDto> {
  return update(ctx, id, { lat, lng })
}

/** Manual per-building geocode through the Geocoder port (ARCHITECTURE D19). */
export async function geocode(ctx: Ctx, id: string): Promise<GeocodeResultDto> {
  const b = await repo.findBuilding(ctx.tenantId, id)
  if (!b) throw notFound()
  const address = b.address as CreateBuildingBody['address']
  let hit: Awaited<ReturnType<typeof adapters.geocoder.geocode>> = null
  try {
    hit = await adapters.geocoder.geocode(b.addressText, { city: address.city, countryCode: 'bg' })
  } catch (err) {
    logger.warn({ err, buildingId: id }, 'geocoder failed')
    throw new AppError(502, 'buildings.geocodeUnavailable')
  }
  const updated = await repo.updateBuilding(ctx.tenantId, id, {
    ...(hit
      ? {
          lat: hit.lat,
          lng: hit.lng,
          geocodeStatus: 'ok',
          geocodeConfidence: hit.confidence,
          geocodeProvider: hit.provider,
        }
      : { geocodeStatus: 'failed', geocodeProvider: adapters.geocoder.name }),
    updatedBy: ctx.userId,
  })
  await audit(actorOf(ctx), {
    action: 'building.geocode',
    entityType: 'building',
    entityId: id,
    after: { lat: updated.lat, lng: updated.lng, status: updated.geocodeStatus },
  })
  return {
    status: updated.geocodeStatus,
    lat: updated.lat,
    lng: updated.lng,
    confidence: updated.geocodeConfidence,
    provider: updated.geocodeProvider,
  }
}

export async function archive(ctx: Ctx, id: string): Promise<void> {
  const before = await repo.findBuilding(ctx.tenantId, id)
  if (!before) throw notFound()
  if (before._count.elevators > 0) throw new AppError(409, 'buildings.hasElevators')
  await repo.updateBuilding(ctx.tenantId, id, { deletedAt: clock.now(), updatedBy: ctx.userId })
  await audit(actorOf(ctx), { action: 'building.archive', entityType: 'building', entityId: id })
}
