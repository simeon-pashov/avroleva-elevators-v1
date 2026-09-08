import type { ContactDto, CreateContactBody, Page, UpdateContactBody } from '@avroleva/contracts'
import type { Ctx } from '../../../platform/http/ctx.js'
import { actorOf } from '../../../platform/http/ctx.js'
import { notFound } from '../../../platform/http/errors.js'
import { toPage } from '../../../platform/http/pagination.js'
import { audit } from '../../../platform/audit.js'
import { clock } from '../../../platform/clock.js'
import { events } from '../../../platform/events/bus.js'
import * as repo from '../repo/contacts.js'
import * as customers from '../repo/customers.js'
import * as buildings from '../repo/buildings.js'
import { toContactDto } from '../domain/mappers.js'
import { normalizePhone } from '../domain/address.js'

async function assertParents(ctx: Ctx, customerId?: string | null, buildingId?: string | null) {
  if (customerId && !(await customers.findCustomer(ctx.tenantId, customerId))) throw notFound()
  if (buildingId && !(await buildings.findBuilding(ctx.tenantId, buildingId))) throw notFound()
}

export async function list(
  ctx: Ctx,
  q: { cursor?: string; limit: number; q?: string; customerId?: string; buildingId?: string },
): Promise<Page<ContactDto>> {
  return toPage(await repo.listContacts(ctx.tenantId, q), q.limit, toContactDto)
}

export async function create(ctx: Ctx, body: CreateContactBody): Promise<ContactDto> {
  await assertParents(ctx, body.customerId, body.buildingId)
  const c = await repo.createContact(ctx.tenantId, {
    customerId: body.customerId ?? null,
    buildingId: body.buildingId ?? null,
    name: body.name,
    role: body.role,
    phone: normalizePhone(body.phone),
    hasViber: body.hasViber,
    email: body.email || null,
    isPrimary: body.isPrimary,
    notes: body.notes ?? null,
  })
  await audit(actorOf(ctx), { action: 'contact.create', entityType: 'contact', entityId: c.id })
  await events.publish(ctx, {
    type: 'ContactChanged',
    aggregateType: 'contact',
    aggregateId: c.id,
    payload: { buildingId: c.buildingId, customerId: c.customerId },
  })
  return toContactDto(c)
}

export async function update(ctx: Ctx, id: string, body: UpdateContactBody): Promise<ContactDto> {
  const before = await repo.findContact(ctx.tenantId, id)
  if (!before) throw notFound()
  await assertParents(ctx, body.customerId, body.buildingId)
  const c = await repo.updateContact(ctx.tenantId, id, {
    ...(body.customerId !== undefined ? { customerId: body.customerId } : {}),
    ...(body.buildingId !== undefined ? { buildingId: body.buildingId } : {}),
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.role !== undefined ? { role: body.role } : {}),
    ...(body.phone !== undefined ? { phone: normalizePhone(body.phone) } : {}),
    ...(body.hasViber !== undefined ? { hasViber: body.hasViber } : {}),
    ...(body.email !== undefined ? { email: body.email || null } : {}),
    ...(body.isPrimary !== undefined ? { isPrimary: body.isPrimary } : {}),
    ...(body.notes !== undefined ? { notes: body.notes } : {}),
  })
  await audit(actorOf(ctx), {
    action: 'contact.update',
    entityType: 'contact',
    entityId: id,
    before: { phone: before.phone },
    after: { phone: c.phone },
  })
  await events.publish(ctx, {
    type: 'ContactChanged',
    aggregateType: 'contact',
    aggregateId: c.id,
    payload: { buildingId: c.buildingId, customerId: c.customerId },
  })
  return toContactDto(c)
}

export async function archive(ctx: Ctx, id: string): Promise<void> {
  const before = await repo.findContact(ctx.tenantId, id)
  if (!before) throw notFound()
  await repo.updateContact(ctx.tenantId, id, { deletedAt: clock.now() })
  await audit(actorOf(ctx), { action: 'contact.archive', entityType: 'contact', entityId: id })
}

/** Sync facade read model: building contacts, tombstones included. */
export function listAllForSync(tenantId: string, since: Date | null) {
  return repo.listAllForSync(tenantId, since)
}
