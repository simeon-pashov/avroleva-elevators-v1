import type { RequestHandler } from 'express'
import { randomUUID } from 'node:crypto'

const SAFE = /^[A-Za-z0-9._-]{8,64}$/

export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.header('x-request-id')
  const id = incoming && SAFE.test(incoming) ? incoming : randomUUID()
  req.requestId = id
  res.setHeader('X-Request-Id', id)
  next()
}
