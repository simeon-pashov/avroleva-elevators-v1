import { prisma, prismaBase } from '../../../platform/db/prisma.js'
import { newId } from '../../../platform/ids.js'
import type { AccessLinkScope, BuildingAccessLink } from '../../../generated/prisma/index.js'

export type AccessLinkRow = BuildingAccessLink

export function listForBuilding(tenantId: string, buildingId: string): Promise<AccessLinkRow[]> {
  return prisma.buildingAccessLink.findMany({
    where: { tenantId, buildingId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  })
}

export function find(
  tenantId: string,
  buildingId: string,
  id: string,
): Promise<AccessLinkRow | null> {
  return prisma.buildingAccessLink.findFirst({ where: { tenantId, buildingId, id } })
}

/** Newest link that is neither revoked nor expired at `now`. */
export function newestActive(
  tenantId: string,
  buildingId: string,
  now: Date,
): Promise<AccessLinkRow | null> {
  return prisma.buildingAccessLink.findFirst({
    where: { tenantId, buildingId, revokedAt: null, expiresAt: { gt: now } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  })
}

/**
 * Token lookup is global (the public page has no tenant yet; the 128-bit token is the
 * authorisation, like the public QR page and the payment links), so it uses the unscoped client;
 * the row carries the tenant and every write that follows is scoped by it.
 */
export function findByToken(token: string) {
  return prismaBase.buildingAccessLink.findUnique({
    where: { token },
    include: { building: { select: { addressText: true, deletedAt: true } } },
  })
}

export function create(
  tenantId: string,
  v: {
    buildingId: string
    token: string
    scope: AccessLinkScope
    createdBy: string | null
    expiresAt: Date
  },
): Promise<AccessLinkRow> {
  return prisma.buildingAccessLink.create({ data: { id: newId(), tenantId, ...v } })
}

export function revoke(
  tenantId: string,
  id: string,
  v: { revokedAt: Date; revokedBy: string | null },
): Promise<AccessLinkRow> {
  return prisma.buildingAccessLink.update({ where: { id, tenantId }, data: v })
}

/** Counts opens: `useCount += n`, last use and the keyed IP hash (no personal data). */
export function touchUse(
  tenantId: string,
  id: string,
  v: { count: number; at: Date; ipHash: string },
): Promise<AccessLinkRow> {
  return prisma.buildingAccessLink.update({
    where: { id, tenantId },
    data: { useCount: { increment: v.count }, lastUsedAt: v.at, lastIpHash: v.ipHash },
  })
}
