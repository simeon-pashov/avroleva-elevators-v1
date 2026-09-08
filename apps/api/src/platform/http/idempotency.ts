import { createHash } from 'node:crypto'
import type { RequestHandler, Response } from 'express'
import { IDEMPOTENCY_HEADER, IDEMPOTENCY_TTL_DAYS } from '@avroleva/contracts'
import { prisma } from '../db/prisma.js'
import { clock } from '../clock.js'
import { logger } from '../logger.js'
import { AppError, badRequest } from './errors.js'

const KEY_SHAPE = /^[A-Za-z0-9._:-]{8,128}$/

/** Canonical JSON (sorted keys) so `{a,b}` and `{b,a}` hash alike. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>
    return `{${Object.keys(o)
      .sort()
      .filter((k) => o[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

export function requestHash(body: unknown): string {
  return createHash('sha256').update(canonical(body)).digest('hex')
}

/**
 * `Idempotency-Key` (ARCHITECTURE section 5): the first response under (tenantId, key) is stored
 * for 7 days; the same key with the same body hash replays it (`Idempotency-Replayed: true`),
 * the same key with a different body is rejected with 422. `required` makes a missing header a 400
 * (sync push); elsewhere the header is optional.
 */
export function idempotent(opts: { required?: boolean } = {}): RequestHandler {
  return async (req, res, next) => {
    const key = req.header(IDEMPOTENCY_HEADER)
    if (!key) {
      if (opts.required) return next(badRequest('sync.idempotencyKeyRequired'))
      return next()
    }
    if (!KEY_SHAPE.test(key)) return next(badRequest('sync.idempotencyKeyInvalid'))
    if (!req.ctx) return next()
    const tenantId = req.ctx.tenantId
    const hash = requestHash(req.body)
    try {
      const cutoff = new Date(clock.now().getTime() - IDEMPOTENCY_TTL_DAYS * 86_400_000)
      const stored = await prisma.idempotencyKey.findFirst({
        where: { tenantId, key, createdAt: { gte: cutoff } },
      })
      if (stored) {
        if (stored.requestHash !== hash) return next(new AppError(422, 'sync.idempotencyMismatch'))
        res.setHeader('Idempotency-Replayed', 'true')
        res.status(stored.responseStatus).json(stored.responseBody)
        return
      }
    } catch (err) {
      return next(err)
    }
    // Capture the JSON response of the handler and store it once (only 2xx/4xx bodies are worth
    // replaying; 5xx must be retried).
    const originalJson = res.json.bind(res)
    res.json = ((body: unknown) => {
      const status = res.statusCode
      if (status < 500) {
        void prisma.idempotencyKey
          .create({
            data: {
              tenantId,
              key,
              requestHash: hash,
              responseStatus: status,
              responseBody: body as object,
            },
          })
          .catch((err: { code?: string }) => {
            // P2002 = a concurrent identical request won the race; its stored response is the same.
            if (err?.code !== 'P2002')
              logger.warn({ err, key }, 'idempotency store failed (ignored)')
          })
      }
      return originalJson(body)
    }) as Response['json']
    next()
  }
}

/** Lazy TTL sweep; called by the sync facade on every Nth push. */
export async function sweepIdempotencyKeys(tenantId: string): Promise<number> {
  const cutoff = new Date(clock.now().getTime() - IDEMPOTENCY_TTL_DAYS * 86_400_000)
  const r = await prisma.idempotencyKey.deleteMany({
    where: { tenantId, createdAt: { lt: cutoff } },
  })
  return r.count
}
