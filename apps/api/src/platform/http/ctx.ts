import type { RequestHandler } from 'express'
import type { UserRole } from '@avroleva/contracts'
import { createT } from '@avroleva/i18n'
import type { T } from '@avroleva/i18n'
import type { AuditActor } from '../audit.js'
import { forbidden, unauthorized } from './errors.js'

/** Per-request tenant context (ARCHITECTURE section 5): tenantId comes from the session only. */
export interface Ctx {
  tenantId: string
  userId: string
  role: UserRole
  sessionId: string
  requestId: string
  locale: string
  t: T
  ip?: string
}

export interface AdminCtx {
  adminId: string
  username: string
  sessionId: string
  requestId: string
  locale: string
  t: T
  ip?: string
}

export const CSRF_HEADER = 'x-requested-with'
export const CSRF_VALUE = 'avroleva'
export const SESSION_COOKIE = 'avroleva_session'
export const ADMIN_COOKIE = 'avroleva_admin'

/**
 * Context for jobs and subscribers acting on a tenant without a user (system actor): tenant reads
 * work as for an owner; audit entries written with it carry actorType 'system'.
 */
export function systemCtx(tenantId: string, locale = 'bg', requestId = 'system'): Ctx {
  return {
    tenantId,
    userId: '',
    role: 'owner',
    sessionId: '',
    requestId,
    locale,
    t: createT(locale),
  }
}

export function systemActorOf(tenantId: string | null): AuditActor {
  return { tenantId, actorType: 'system', actorId: null, requestId: 'system' }
}

export function actorOf(ctx: Ctx): AuditActor {
  return {
    tenantId: ctx.tenantId,
    actorType: 'user',
    actorId: ctx.userId,
    requestId: ctx.requestId,
    ip: ctx.ip,
  }
}

export function adminActorOf(admin: AdminCtx): AuditActor {
  return {
    tenantId: null,
    actorType: 'platformAdmin',
    actorId: admin.adminId,
    requestId: admin.requestId,
    ip: admin.ip,
  }
}

export const CLIENT_HEADER = 'x-client'
export const CLIENT_APP = 'app'

/**
 * CSRF (ARCHITECTURE section 5): a cookie-authenticated request of any method, and any mutating
 * request without a Bearer token, must carry `X-Requested-With: avroleva`. Bearer requests are
 * exempt. The technician app's `X-Client: app` counts as the custom header too (a cross-site form
 * cannot set either), which is what lets `POST /auth/enroll` work before the phone has a token.
 */
export const csrfGuard: RequestHandler = (req, _res, next) => {
  const hasHeader =
    req.header(CSRF_HEADER) === CSRF_VALUE || req.header(CLIENT_HEADER) === CLIENT_APP
  const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(req.method)
  const bearer = typeof req.header('authorization') === 'string'
  if (req.authVia === 'cookie' && !hasHeader) return next(forbidden('auth.csrf'))
  if (mutating && !bearer && !hasHeader) return next(forbidden('auth.csrf'))
  next()
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.ctx) return next(unauthorized('auth.required'))
  next()
}

export function requireRole(...roles: UserRole[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.ctx) return next(unauthorized('auth.required'))
    if (!roles.includes(req.ctx.role)) return next(forbidden('auth.forbidden'))
    next()
  }
}

export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (!req.admin) return next(unauthorized('admin.required'))
  next()
}

/** Non-null accessor for handlers mounted behind requireAuth. */
export function ctxOf(req: { ctx?: Ctx }): Ctx {
  if (!req.ctx) throw unauthorized('auth.required')
  return req.ctx
}

export function adminOf(req: { admin?: AdminCtx }): AdminCtx {
  if (!req.admin) throw unauthorized('admin.required')
  return req.admin
}
