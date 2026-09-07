import type { ZodType } from 'zod'
import type { Request } from 'express'
import { notFound } from './errors.js'

/** Parse and return the body; a ZodError propagates to the RFC 7807 handler as 400. */
export function parseBody<T>(schema: ZodType<T>, req: Request): T {
  return schema.parse(req.body ?? {})
}

export function parseQuery<T>(schema: ZodType<T>, req: Request): T {
  return schema.parse(req.query ?? {})
}

/** A route `:id` that is not a UUID is treated exactly like an unknown id: 404, no shape leak. */
export function parseId(req: Request, name = 'id'): string {
  const value = req.params[name]
  const id = Array.isArray(value) ? value[0] : value
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) throw notFound()
  return id
}
