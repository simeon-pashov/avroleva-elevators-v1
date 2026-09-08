import { prisma, prismaBase } from '../../../platform/db/prisma.js'
import { newId } from '../../../platform/ids.js'

export function createEnrollmentToken(input: {
  tenantId: string
  userId: string
  codeHash: string
  expiresAt: Date
  createdByUserId: string | null
}) {
  return prisma.deviceEnrollmentToken.create({ data: { id: newId(), ...input } })
}

/**
 * The phone presents the code without any session, so the lookup is unscoped (the hash is 256
 * bits of entropy); the tenant is read from the row.
 */
export function findEnrollmentByHash(codeHash: string) {
  return prismaBase.deviceEnrollmentToken.findUnique({
    where: { codeHash },
    include: { user: { include: { tenant: true } } },
  })
}

/** Marks the token used; the `usedAt: null` guard makes a double redeem lose the race. */
export async function consumeEnrollment(tenantId: string, id: string, at: Date): Promise<boolean> {
  const r = await prisma.deviceEnrollmentToken.updateMany({
    where: { id, tenantId, usedAt: null },
    data: { usedAt: at },
  })
  return r.count === 1
}

export function listSessions(tenantId: string, now: Date) {
  return prisma.session.findMany({
    where: {
      tenantId,
      revokedAt: null,
      expiresAt: { gt: now },
      kind: { in: ['browser', 'device'] },
    },
    include: { user: { select: { id: true, name: true } } },
    orderBy: [{ kind: 'desc' }, { lastSeenAt: 'desc' }],
  })
}

export function findSession(tenantId: string, id: string) {
  return prisma.session.findFirst({ where: { id, tenantId } })
}

export function updateSessionClient(
  id: string,
  data: { deviceName?: string; clientVersion?: string },
) {
  return prismaBase.session.update({ where: { id }, data })
}
