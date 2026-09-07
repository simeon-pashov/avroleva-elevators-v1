import { prismaBase } from './db/prisma.js'
import type { Tx } from './db/prisma.js'
import { logger } from './logger.js'

export interface AuditEntry {
  action: string
  entityType: string
  entityId?: string | null
  before?: unknown
  after?: unknown
}

export interface AuditActor {
  tenantId?: string | null
  actorType: 'user' | 'system' | 'public' | 'platformAdmin'
  actorId?: string | null
  requestId?: string
  ip?: string
}

/**
 * Audit log (ARCHITECTURE section 3): every mutation records actor, request and a before/after diff.
 * Step 1: plain INSERT rows; the hash chain and INSERT-only grants are a later step.
 */
export async function audit(actor: AuditActor, entry: AuditEntry, tx?: Tx): Promise<void> {
  const db: Tx = tx ?? (prismaBase as unknown as Tx)
  try {
    await db.auditLog.create({
      data: {
        tenantId: actor.tenantId ?? null,
        actorType: actor.actorType,
        actorId: actor.actorId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        before: entry.before === undefined ? undefined : (entry.before as object),
        after: entry.after === undefined ? undefined : (entry.after as object),
        requestId: actor.requestId ?? null,
        ip: actor.ip ?? null,
      },
    })
  } catch (err) {
    logger.error({ err, action: entry.action }, 'audit write failed')
    if (tx) throw err
  }
}
