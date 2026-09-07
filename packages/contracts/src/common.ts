import { z } from 'zod'

export const uuid = z.uuid()
export const isoDate = z.iso.date() // YYYY-MM-DD
export const isoDateTime = z.iso.datetime({ offset: true })

/** Trimmed string; empty becomes undefined so optional fields can be cleared with "". */
export const optionalText = (max = 500) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().trim().max(max).optional(),
  )

/** Same as optionalText but explicit null clears the value on PATCH. */
export const nullableText = (max = 500) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.string().trim().max(max).nullable().optional(),
  )

export const nullableNumber = (schema: z.ZodNumber) =>
  z.preprocess((v) => (v === '' ? null : v), schema.nullable().optional())

export const nullableDate = z.preprocess(
  (v) => (v === '' ? null : v),
  isoDate.nullable().optional(),
)

export const phone = z
  .string()
  .trim()
  .regex(/^[+0-9 ()./-]{5,25}$/, { message: 'validation.phone' })

export const listQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  q: z.string().trim().max(200).optional(),
})
export type ListQuery = z.infer<typeof listQuery>

export interface Page<T> {
  items: T[]
  nextCursor: string | null
}

/** RFC 7807 problem details; `code` and `detail` are i18n keys resolved server-side. */
export interface Problem {
  type: string
  title: string
  status: number
  code: string
  detail?: string
  fields?: Array<{ path: string; code: string; message: string }>
  requestId?: string
}
