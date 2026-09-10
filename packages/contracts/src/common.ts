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

/**
 * PATCH body of a create schema. zod 4's `.partial()` keeps `.default()`s and `.prefault()`s, and
 * both still fire behind `.optional()`, so a partial body would silently reset every defaulted
 * field (status, kind, a whole settings block...) to its default. This strips them first, recursing
 * into nested objects (`settings.billing.bank`): a missing key stays `undefined` at every level and
 * the service deep-merges the patch over the stored value. Nested objects that are not plain
 * `z.object()`s (nullable / optional wrappers such as `bankCsvMapping`) are kept whole.
 */
export function patchOf<T extends z.ZodRawShape>(
  obj: z.ZodObject<T>,
): z.ZodObject<{ [K in keyof T]: z.ZodOptional<T[K] extends z.ZodDefault<infer U> ? U : T[K]> }> {
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const [key, schema] of Object.entries(obj.shape) as Array<[string, z.ZodTypeAny]>) {
    let inner: z.ZodTypeAny = schema
    while (inner instanceof z.ZodDefault || inner instanceof z.ZodPrefault) inner = inner.unwrap()
    if (inner instanceof z.ZodObject) inner = patchOf(inner as z.ZodObject<z.ZodRawShape>)
    shape[key] = inner.optional()
  }
  return z.object(shape) as unknown as z.ZodObject<{
    [K in keyof T]: z.ZodOptional<T[K] extends z.ZodDefault<infer U> ? U : T[K]>
  }>
}

/**
 * Applies a `patchOf()` body over a stored object: plain objects merge key by key (recursively),
 * everything else (scalars, arrays, `null`) replaces the stored value; `undefined` keys are
 * skipped. `null` therefore means "clear this key" for nullable fields.
 */
export function mergePatch<T extends Record<string, unknown>>(current: T, patch: unknown): T {
  if (!isPlainObject(patch)) return current
  const out: Record<string, unknown> = { ...current }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    const prev = out[key]
    out[key] =
      isPlainObject(value) && isPlainObject(prev)
        ? mergePatch(prev as Record<string, unknown>, value)
        : value
  }
  return out as T
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
