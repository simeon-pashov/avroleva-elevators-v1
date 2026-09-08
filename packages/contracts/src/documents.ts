import { z } from 'zod'
import { isoDateTime, uuid } from './common.js'

// Values are the Postgres enum values (apps/api/prisma/schema.prisma) - keep them in sync.
export const AttachmentKind = z.enum(['photo', 'document'])
export type AttachmentKind = z.infer<typeof AttachmentKind>

export const AttachmentRole = z.enum(['photo', 'logbook_page'])
export type AttachmentRole = z.infer<typeof AttachmentRole>

export const sha256Hex = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[0-9a-f]{64}$/, { message: 'validation.invalidFormat' })

/** Multipart fields next to the `file` part of POST /attachments. */
export const uploadAttachmentFields = z.object({
  /** Client-generated UUID: the same id twice (same sha256) returns the stored row. */
  id: uuid,
  /** sha256 of the bytes as sent; the server verifies it before re-encoding. */
  sha256: sha256Hex,
  kind: AttachmentKind.default('photo'),
  /** When the photo was taken (device clock), kept after EXIF is stripped. */
  takenAt: isoDateTime.optional(),
})
export type UploadAttachmentFields = z.infer<typeof uploadAttachmentFields>

export const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024
export const ATTACHMENT_MAX_EDGE_PX = 1600
export const ATTACHMENT_THUMB_PX = 320
export const SIGNED_URL_TTL_SECONDS = 15 * 60

export interface AttachmentDto {
  id: string
  kind: AttachmentKind
  /** sha256 of the original upload (what the client computed), not of the re-encoded file. */
  sha256: string
  mime: string
  bytes: number
  width: number | null
  height: number | null
  takenAt: string | null
  createdByUserId: string | null
  createdAt: string
  /** Signed URLs (15 min), relative to the API base path. */
  url: string
  thumbUrl: string
}

/** A visit's link to an attachment; `attachment` is null until the upload lands. */
export const visitAttachmentLink = z.object({
  id: uuid,
  role: AttachmentRole.default('photo'),
})
export type VisitAttachmentLink = z.infer<typeof visitAttachmentLink>

export interface VisitAttachmentDto {
  attachmentId: string
  role: AttachmentRole
  uploaded: boolean
  attachment: AttachmentDto | null
}

export const fileQuery = z.object({
  exp: z.coerce.number().int().positive(),
  sig: z.string().regex(/^[0-9a-f]{64}$/),
  v: z.enum(['full', 'thumb']).default('full'),
})
export type FileQuery = z.infer<typeof fileQuery>
