import { Router } from 'express'
import type { CookieOptions, Response } from 'express'
import rateLimit from 'express-rate-limit'
import {
  createUserBody,
  enrollBody,
  loginBody,
  setPasswordBody,
  updateMeBody,
  updateTenantBody,
  updateUserBody,
  deleteRequestBody,
} from '@avroleva/contracts'
import { config } from '../../../platform/config.js'
import { SESSION_COOKIE, ctxOf, requireAuth, requireRole } from '../../../platform/http/ctx.js'
import { parseBody, parseId } from '../../../platform/http/validate.js'
import * as service from '../service.js'

export function sessionCookieOptions(expiresAt: Date): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.COOKIE_SECURE,
    // Path stays "/" even behind a prefix: nginx strips it before the app sees the request (VPS-GUIDE).
    path: '/',
    expires: expiresAt,
  }
}

export function clearCookie(res: Response, name: string): void {
  res.clearCookie(name, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.COOKIE_SECURE,
    path: '/',
  })
}

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => config.NODE_ENV === 'test',
  handler: (_req, res) => {
    res.status(429).type('application/problem+json').json({
      type: 'about:blank',
      title: 'Too many attempts',
      status: 429,
      code: 'auth.rateLimited',
    })
  },
})

export const authRouter = Router()

authRouter.post('/auth/login', loginLimiter, async (req, res) => {
  const body = parseBody(loginBody, req)
  const result = await service.login(body.username, body.password, {
    ip: req.ip,
    requestId: req.requestId,
  })
  res.cookie(SESSION_COOKIE, result.token, sessionCookieOptions(result.expiresAt))
  res.json({ user: result.user, tenant: result.tenant, locale: result.locale, token: result.token })
})

authRouter.post('/auth/logout', async (req, res) => {
  if (req.ctx) await service.logout(req.ctx.sessionId)
  clearCookie(res, SESSION_COOKIE)
  res.status(204).end()
})

/** Technician phone: one-time QR code -> device session (Bearer). No session required. */
authRouter.post('/auth/enroll', loginLimiter, async (req, res) => {
  const result = await service.enrollDevice(parseBody(enrollBody, req), {
    ip: req.ip,
    requestId: req.requestId,
  })
  res.status(201).json(result)
})

authRouter.get('/auth/sessions', requireRole('owner'), async (req, res) => {
  res.json({ items: await service.listSessions(ctxOf(req)) })
})

authRouter.post('/auth/sessions/:id/revoke', requireRole('owner'), async (req, res) => {
  await service.revokeSessionById(ctxOf(req), parseId(req))
  res.status(204).end()
})

authRouter.get('/auth/me', requireAuth, async (req, res) => {
  res.json(await service.me(ctxOf(req)))
})

authRouter.patch('/auth/me', requireAuth, async (req, res) => {
  res.json(await service.updateMe(ctxOf(req), parseBody(updateMeBody, req)))
})

export const tenantRouter = Router()

tenantRouter.get('/tenant', requireAuth, async (req, res) => {
  res.json(await service.getTenant(ctxOf(req).tenantId))
})

tenantRouter.patch('/tenant', requireRole('owner'), async (req, res) => {
  res.json(await service.updateTenant(ctxOf(req), parseBody(updateTenantBody, req)))
})

/** Delete-my-data: owner, password re-entered, 30-day grace; cancellable until the date. */
tenantRouter.post('/tenant/delete-request', requireRole('owner'), async (req, res) => {
  res.json(await service.requestDeletion(ctxOf(req), parseBody(deleteRequestBody, req).password))
})

tenantRouter.post('/tenant/delete-request/cancel', requireRole('owner'), async (req, res) => {
  res.json(await service.cancelDeletion(ctxOf(req)))
})

export const usersRouter = Router()

usersRouter.get('/users', requireRole('owner', 'office'), async (req, res) => {
  res.json({ items: await service.listUsers(ctxOf(req)) })
})

usersRouter.post('/users', requireRole('owner'), async (req, res) => {
  res.status(201).json(await service.createUser(ctxOf(req), parseBody(createUserBody, req)))
})

usersRouter.patch('/users/:id', requireRole('owner'), async (req, res) => {
  res.json(await service.updateUser(ctxOf(req), parseId(req), parseBody(updateUserBody, req)))
})

usersRouter.post('/users/:id/password', requireRole('owner'), async (req, res) => {
  await service.setUserPassword(ctxOf(req), parseId(req), parseBody(setPasswordBody, req).password)
  res.status(204).end()
})

/** "Connect a phone": a 10-minute one-time code for this technician, rendered as a QR in the office. */
usersRouter.post('/users/:id/enroll-token', requireRole('owner', 'office'), async (req, res) => {
  res.status(201).json(await service.createEnrollmentToken(ctxOf(req), parseId(req)))
})
