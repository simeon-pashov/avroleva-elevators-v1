import type { CreateCustomerBody, CustomerDto, Page, UpdateCustomerBody } from '@avroleva/contracts'
import type { Ctx } from '../../../platform/http/ctx.js'
import { actorOf } from '../../../platform/http/ctx.js'
import { notFound } from '../../../platform/http/errors.js'
import { toPage } from '../../../platform/http/pagination.js'
import { audit } from '../../../platform/audit.js'
import { clock } from '../../../platform/clock.js'
import * as repo from '../repo/customers.js'
import { toCustomerDto } from '../domain/mappers.js'
import type { CustomerKind } from '../../../generated/prisma/index.js'

const email = (e: string | null | undefined) => (e === undefined ? undefined : e || null)

export async function list(
  ctx: Ctx,
  q: { cursor?: string; limit: number; q?: string; kind?: CustomerKind },
): Promise<Page<CustomerDto>> {
  return toPage(await repo.listCustomers(ctx.tenantId, q), q.limit, toCustomerDto)
}

export async function get(ctx: Ctx, id: string): Promise<CustomerDto> {
  const c = await repo.findCustomer(ctx.tenantId, id)
  if (!c) throw notFound()
  return toCustomerDto(c)
}

export async function create(ctx: Ctx, body: CreateCustomerBody): Promise<CustomerDto> {
  const c = await repo.createCustomer(ctx.tenantId, {
    name: body.name,
    kind: body.kind,
    eik: body.eik ?? null,
    vatNo: body.vatNo ?? null,
    billingAddress: body.billingAddress ?? null,
    invoiceEmail: email(body.invoiceEmail) ?? null,
    notes: body.notes ?? null,
    createdBy: ctx.userId,
  })
  await audit(actorOf(ctx), {
    action: 'customer.create',
    entityType: 'customer',
    entityId: c.id,
    after: { name: c.name },
  })
  return toCustomerDto(c)
}

export async function update(ctx: Ctx, id: string, body: UpdateCustomerBody): Promise<CustomerDto> {
  const before = await repo.findCustomer(ctx.tenantId, id)
  if (!before) throw notFound()
  const c = await repo.updateCustomer(ctx.tenantId, id, {
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.kind !== undefined ? { kind: body.kind } : {}),
    ...(body.eik !== undefined ? { eik: body.eik } : {}),
    ...(body.vatNo !== undefined ? { vatNo: body.vatNo } : {}),
    ...(body.billingAddress !== undefined ? { billingAddress: body.billingAddress } : {}),
    ...(body.invoiceEmail !== undefined ? { invoiceEmail: email(body.invoiceEmail) } : {}),
    ...(body.notes !== undefined ? { notes: body.notes } : {}),
    updatedBy: ctx.userId,
  })
  await audit(actorOf(ctx), {
    action: 'customer.update',
    entityType: 'customer',
    entityId: id,
    before: { name: before.name, kind: before.kind },
    after: { name: c.name, kind: c.kind },
  })
  return toCustomerDto({ ...c, _count: before._count })
}

/** Archive (soft delete) - never a hard delete (ARCHITECTURE section 3). */
export async function archive(ctx: Ctx, id: string): Promise<void> {
  const before = await repo.findCustomer(ctx.tenantId, id)
  if (!before) throw notFound()
  await repo.updateCustomer(ctx.tenantId, id, { deletedAt: clock.now(), updatedBy: ctx.userId })
  await audit(actorOf(ctx), { action: 'customer.archive', entityType: 'customer', entityId: id })
}
