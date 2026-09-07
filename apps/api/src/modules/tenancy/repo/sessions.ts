import { prismaBase } from '../../../platform/db/prisma.js'
import { newId } from '../../../platform/ids.js'
import { clock } from '../../../platform/clock.js'
import { logger } from '../../../platform/logger.js'
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

/**
 * Sliding expiry: extend at most once per hour. Best-effort by design: a page reload fires a burst
 * of requests on the same aged session, and a logout may race with them, so the write is an
 * `updateMany` (no P2025 when the row was revoked in between) and a failure is logged, never
 * propagated - the request is already authenticated.
 */
export async function touchSession(s: {
  id: string
  lastSeenAt: Date
  kind: SessionKind
}): Promise<void> {
  const now = clock.now()
  if (!shouldRenew(s, now)) return
  try {
    await prismaBase.session.updateMany({
      where: { id: s.id, revokedAt: null, lastSeenAt: { lt: new Date(now.getTime() - 1000) } },
      data: { lastSeenAt: now, expiresAt: new Date(now.getTime() + sessionTtlMs(s.kind)) },
    })
  } catch (err) {
    logger.warn({ err, sessionId: s.id }, 'session touch failed (ignored)')
  }
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
