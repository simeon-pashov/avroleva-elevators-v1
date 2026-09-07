import { prismaBase } from '../../../platform/db/prisma.js'
import { newId } from '../../../platform/ids.js'
import { clock } from '../../../platform/clock.js'
import { generateToken, hashToken, sessionTtlMs, shouldRenew } from '../domain/session.js'
import type { SessionKind } from '../../../generated/prisma/index.js'

export interface NewSession {
  kind: SessionKind
  tenantId?: string | null
  userId?: string | null
  adminId?: string | null
  ip?: string
  deviceName?: string
}

export async function createSession(
  input: NewSession,
): Promise<{ id: string; token: string; expiresAt: Date }> {
  const { token, tokenHash } = generateToken()
  const now = clock.now()
  const expiresAt = new Date(now.getTime() + sessionTtlMs(input.kind))
  const row = await prismaBase.session.create({
    data: {
      id: newId(),
      kind: input.kind,
      tenantId: input.tenantId ?? null,
      userId: input.userId ?? null,
      adminId: input.adminId ?? null,
      tokenHash,
      ip: input.ip ?? null,
      deviceName: input.deviceName ?? null,
      lastSeenAt: now,
      expiresAt,
    },
  })
  return { id: row.id, token, expiresAt }
}

export function findSessionByToken(token: string) {
  return prismaBase.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true, tenant: true, admin: true },
  })
}

/** Sliding expiry: extend at most once per hour. */
export async function touchSession(s: {
  id: string
  lastSeenAt: Date
  kind: SessionKind
}): Promise<void> {
  const now = clock.now()
  if (!shouldRenew(s, now)) return
  await prismaBase.session.update({
    where: { id: s.id },
    data: { lastSeenAt: now, expiresAt: new Date(now.getTime() + sessionTtlMs(s.kind)) },
  })
}

export async function revokeSession(id: string): Promise<void> {
  await prismaBase.session.updateMany({
    where: { id, revokedAt: null },
    data: { revokedAt: clock.now() },
  })
}

export async function revokeUserSessions(tenantId: string, userId: string): Promise<void> {
  await prismaBase.session.updateMany({
    where: { tenantId, userId, revokedAt: null },
    data: { revokedAt: clock.now() },
  })
}
