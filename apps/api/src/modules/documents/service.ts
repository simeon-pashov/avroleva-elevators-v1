import { createHash } from 'node:crypto'
import sharp from 'sharp'
import type { AttachmentDto, UploadAttachmentFields, VisitAttachmentDto } from '@avroleva/contracts'
import { ATTACHMENT_MAX_EDGE_PX, ATTACHMENT_THUMB_PX } from '@avroleva/contracts'
import type { Ctx } from '../../platform/http/ctx.js'
import { actorOf } from '../../platform/http/ctx.js'
import { AppError, notFound } from '../../platform/http/errors.js'
import { audit } from '../../platform/audit.js'
import { adapters } from '../../platform/adapters/index.js'
import { clock } from '../../platform/clock.js'
import type { Tx } from '../../platform/db/prisma.js'
import { signedFileUrl } from '../../platform/signedUrl.js'
import type { FileVariant } from '../../platform/signedUrl.js'
import * as repo from './repo/attachments.js'
import type { AttachmentRow, VisitLink } from './repo/attachments.js'

export function toAttachmentDto(a: AttachmentRow): AttachmentDto {
  return {
    id: a.id,
    kind: a.kind,
    sha256: a.sha256,
    mime: a.mime,
    bytes: a.bytes,
    width: a.width,
    height: a.height,
    takenAt: a.takenAt ? a.takenAt.toISOString() : null,
    createdByUserId: a.createdByUserId,
    createdAt: a.createdAt.toISOString(),
    url: signedFileUrl(a.id, 'full', a.tenantId),
    thumbUrl: signedFileUrl(a.id, a.thumbKey ? 'thumb' : 'full', a.tenantId),
  }
}

export function sha256Of(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** `attachments/<tenant>/<yy>/<mm>/<id>.jpg` (ARCHITECTURE section 6 layout). */
export function storageKeyFor(tenantId: string, id: string, at: Date, suffix = ''): string {
  const yy = String(at.getUTCFullYear()).slice(-2)
  const mm = String(at.getUTCMonth() + 1).padStart(2, '0')
  return `attachments/${tenantId}/${yy}/${mm}/${id}${suffix}.jpg`
}

export interface ProcessedImage {
  full: Buffer
  thumb: Buffer
  width: number
  height: number
}

/**
 * Re-encodes any browser image to JPEG <= 1600 px on the long edge (q80), honouring the EXIF
 * orientation first and dropping every metadata block (EXIF/GPS/ICC) - the row keeps `takenAt`.
 * Also makes a 320 px thumbnail. Rejects anything sharp cannot decode.
 */
export async function processImage(input: Buffer): Promise<ProcessedImage> {
  const base = sharp(input, { failOn: 'error' }).rotate()
  const full = await base
    .clone()
    .resize({
      width: ATTACHMENT_MAX_EDGE_PX,
      height: ATTACHMENT_MAX_EDGE_PX,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer({ resolveWithObject: true })
  const thumb = await base
    .clone()
    .resize({
      width: ATTACHMENT_THUMB_PX,
      height: ATTACHMENT_THUMB_PX,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 70 })
    .toBuffer()
  return { full: full.data, thumb, width: full.info.width, height: full.info.height }
}

/**
 * Upload (idempotent on the client id): the same id with the same sha256 returns the stored row;
 * the same id with different bytes is a 409. The hash is verified on the bytes as received.
 */
export async function upload(
  ctx: Ctx,
  fields: UploadAttachmentFields,
  file: { buffer: Buffer; mimetype: string; originalname?: string },
): Promise<{ attachment: AttachmentDto; created: boolean }> {
  const existing = await repo.findAttachment(ctx.tenantId, fields.id)
  if (existing) {
    if (existing.sha256 !== fields.sha256) throw new AppError(409, 'attachments.idReused')
    return { attachment: toAttachmentDto(existing), created: false }
  }
  const actual = sha256Of(file.buffer)
  if (actual !== fields.sha256) throw new AppError(400, 'attachments.hashMismatch')
  if (fields.kind !== 'photo') throw new AppError(400, 'attachments.unsupportedKind')

  let img: ProcessedImage
  try {
    img = await processImage(file.buffer)
  } catch {
    throw new AppError(400, 'attachments.notAnImage')
  }
  const now = clock.now()
  const storageKey = storageKeyFor(ctx.tenantId, fields.id, now)
  const thumbKey = storageKeyFor(ctx.tenantId, fields.id, now, '.thumb')
  await adapters.storage.put(storageKey, img.full, 'image/jpeg')
  await adapters.storage.put(thumbKey, img.thumb, 'image/jpeg')
  let row: AttachmentRow
  try {
    row = await repo.createAttachment(ctx.tenantId, {
      id: fields.id,
      kind: fields.kind,
      sha256: fields.sha256,
      mime: 'image/jpeg',
      bytes: img.full.length,
      width: img.width,
      height: img.height,
      takenAt: fields.takenAt ? new Date(fields.takenAt) : null,
      storageKey,
      thumbKey,
      createdByUserId: ctx.userId,
    })
  } catch (err) {
    // Two uploads of the same id raced; the first one wins and both get the same answer.
    if ((err as { code?: string }).code === 'P2002') {
      const again = await repo.findAttachment(ctx.tenantId, fields.id)
      if (again) return { attachment: toAttachmentDto(again), created: false }
    }
    throw err
  }
  await audit(actorOf(ctx), {
    action: 'attachment.upload',
    entityType: 'attachment',
    entityId: row.id,
    after: { kind: row.kind, bytes: row.bytes, sha256: row.sha256 },
  })
  return { attachment: toAttachmentDto(row), created: true }
}

export async function get(ctx: Ctx, id: string): Promise<AttachmentDto> {
  const a = await repo.findAttachment(ctx.tenantId, id)
  if (!a) throw notFound()
  return toAttachmentDto(a)
}

export function findOwner(id: string) {
  return repo.findOwner(id)
}

/** Bytes for the signed-URL route; the caller has already verified the signature for `tenantId`. */
export async function readFile(
  tenantId: string,
  id: string,
  variant: FileVariant,
): Promise<{ bytes: Buffer; mime: string } | null> {
  const a = await repo.findAttachment(tenantId, id)
  if (!a) return null
  const key = variant === 'thumb' && a.thumbKey ? a.thumbKey : a.storageKey
  return adapters.storage.get(key)
}

/** Called by visits (L3) in its transaction: the links exist before the photos land. */
export function linkToVisit(
  tenantId: string,
  visitId: string,
  links: VisitLink[],
  tx?: Tx,
): Promise<void> {
  return repo.linkToVisit(tenantId, visitId, links, tx)
}

/** Attachment view per visit for the DTOs: uploaded rows with signed URLs, pending ones as stubs. */
export async function attachmentsForVisits(
  tenantId: string,
  visitIds: string[],
  tx?: Tx,
): Promise<Map<string, VisitAttachmentDto[]>> {
  const links = await repo.linksForVisits(tenantId, visitIds, tx)
  const rows = await repo.findAttachmentsByIds(
    tenantId,
    [...new Set(links.map((l) => l.attachmentId))],
    tx,
  )
  const byId = new Map(rows.map((r) => [r.id, r]))
  const out = new Map<string, VisitAttachmentDto[]>()
  for (const l of links) {
    const a = byId.get(l.attachmentId)
    const list = out.get(l.visitId) ?? []
    list.push({
      attachmentId: l.attachmentId,
      role: l.role,
      uploaded: !!a,
      attachment: a ? toAttachmentDto(a) : null,
    })
    out.set(l.visitId, list)
  }
  return out
}
