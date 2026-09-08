import { prisma, prismaBase } from '../../../platform/db/prisma.js'
import type { Tx } from '../../../platform/db/prisma.js'
import { newId } from '../../../platform/ids.js'
import type { Attachment, AttachmentKind, AttachmentRole } from '../../../generated/prisma/index.js'

export type AttachmentRow = Attachment

export function findAttachment(
  tenantId: string,
  id: string,
  tx?: Tx,
): Promise<AttachmentRow | null> {
  const db = tx ?? prisma
  return db.attachment.findFirst({ where: { id, tenantId } })
}

/**
 * The one unscoped read of this module: the signed-URL route has no session, so the tenant comes
 * from the row and is then checked against the tenant bound into the signature.
 */
export function findOwner(id: string): Promise<{ tenantId: string } | null> {
  return prismaBase.attachment.findUnique({ where: { id }, select: { tenantId: true } })
}

export function findAttachmentsByIds(tenantId: string, ids: string[], tx?: Tx) {
  if (ids.length === 0) return Promise.resolve([] as AttachmentRow[])
  const db = tx ?? prisma
  return db.attachment.findMany({ where: { tenantId, id: { in: ids } } })
}

export interface AttachmentInput {
  id: string
  kind: AttachmentKind
  sha256: string
  mime: string
  bytes: number
  width: number | null
  height: number | null
  takenAt: Date | null
  storageKey: string
  thumbKey: string | null
  createdByUserId: string | null
}

export function createAttachment(tenantId: string, a: AttachmentInput, tx?: Tx) {
  const db = tx ?? prisma
  return db.attachment.create({ data: { tenantId, ...a } })
}

export function countAttachments(tenantId: string) {
  return prisma.attachment.count({ where: { tenantId } })
}

// ---- visit links -----------------------------------------------------------------------------

export interface VisitLink {
  attachmentId: string
  role: AttachmentRole
}

/** Idempotent: re-linking the same attachment to the same visit is a no-op (position/role refresh). */
export async function linkToVisit(
  tenantId: string,
  visitId: string,
  links: VisitLink[],
  tx?: Tx,
): Promise<void> {
  const db = tx ?? prisma
  const existing = await db.visitAttachment.findMany({ where: { tenantId, visitId } })
  const byAttachment = new Map(existing.map((l) => [l.attachmentId, l]))
  for (const [i, l] of links.entries()) {
    const cur = byAttachment.get(l.attachmentId)
    if (cur) {
      if (cur.role !== l.role || cur.position !== i)
        await db.visitAttachment.update({
          where: { id: cur.id, tenantId },
          data: { role: l.role, position: i },
        })
      continue
    }
    await db.visitAttachment.create({
      data: {
        id: newId(),
        tenantId,
        visitId,
        attachmentId: l.attachmentId,
        role: l.role,
        position: i,
      },
    })
  }
}

export function linksForVisits(tenantId: string, visitIds: string[], tx?: Tx) {
  if (visitIds.length === 0) return Promise.resolve([])
  const db = tx ?? prisma
  return db.visitAttachment.findMany({
    where: { tenantId, visitId: { in: visitIds } },
    orderBy: [{ visitId: 'asc' }, { position: 'asc' }],
  })
}

export function linksForAttachment(tenantId: string, attachmentId: string) {
  return prisma.visitAttachment.findMany({ where: { tenantId, attachmentId } })
}

/** Attachment rows linked to any of the visits (for the retention purge). */
export async function attachmentsLinkedToVisits(tenantId: string, visitIds: string[]) {
  if (visitIds.length === 0) return [] as AttachmentRow[]
  const links = await prisma.visitAttachment.findMany({
    where: { tenantId, visitId: { in: visitIds } },
    select: { attachmentId: true },
  })
  const ids = [...new Set(links.map((l) => l.attachmentId))]
  if (ids.length === 0) return [] as AttachmentRow[]
  return prisma.attachment.findMany({ where: { tenantId, id: { in: ids } } })
}

export async function deleteLinksForVisits(tenantId: string, visitIds: string[]) {
  if (visitIds.length === 0) return 0
  const r = await prisma.visitAttachment.deleteMany({
    where: { tenantId, visitId: { in: visitIds } },
  })
  return r.count
}

export async function deleteAttachments(tenantId: string, ids: string[]) {
  if (ids.length === 0) return 0
  const r = await prisma.attachment.deleteMany({ where: { tenantId, id: { in: ids } } })
  return r.count
}

/** Attachments older than `before` that no visit links to (upload without a visit, or a purge left them). */
export async function listOrphans(tenantId: string, before: Date, limit = 500) {
  const rows = await prisma.attachment.findMany({
    where: { tenantId, createdAt: { lt: before } },
    select: { id: true, storageKey: true, thumbKey: true },
    orderBy: { createdAt: 'asc' },
    take: limit,
  })
  if (rows.length === 0) return rows
  const linked = await prisma.visitAttachment.findMany({
    where: { tenantId, attachmentId: { in: rows.map((r) => r.id) } },
    select: { attachmentId: true },
  })
  const keep = new Set(linked.map((l) => l.attachmentId))
  return rows.filter((r) => !keep.has(r.id))
}

/** Every storage key of a tenant (tenant purge). */
export function allStorageKeys(tenantId: string) {
  return prismaBase.attachment.findMany({
    where: { tenantId },
    select: { storageKey: true, thumbKey: true },
  })
}
