import type { RequestHandler } from 'express'
import { resolveLocale } from '@avroleva/i18n'
import { ADMIN_COOKIE, SESSION_COOKIE } from '../../../platform/http/ctx.js'
import { createT, localeFromAcceptLanguage } from '../../../platform/i18n.js'
import { clock } from '../../../platform/clock.js'
import { isSessionAlive, isTokenShapeValid } from '../domain/session.js'
import { findSessionByToken, touchSession } from '../repo/sessions.js'

function bearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined
  const m = /^Bearer\s+(.+)$/i.exec(header.trim())
  return m?.[1]
}

/**
 * Resolves the session (cookie or `Authorization: Bearer`, one code path) into `req.ctx` or
 * `req.admin`. Never throws: routes decide with requireAuth / requireAdmin.
 */
export const authenticate: RequestHandler = async (req, _res, next) => {
  req.locale = localeFromAcceptLanguage(req.header('accept-language')) ?? 'bg'
  const cookies = (req.cookies ?? {}) as Record<string, string | undefined>
  const bearer = bearerToken(req.header('authorization'))
  const candidates: Array<{ token: string; via: 'cookie' | 'bearer' }> = []
  if (bearer) candidates.push({ token: bearer, via: 'bearer' })
  if (cookies[SESSION_COOKIE]) candidates.push({ token: cookies[SESSION_COOKIE]!, via: 'cookie' })
  if (cookies[ADMIN_COOKIE]) candidates.push({ token: cookies[ADMIN_COOKIE]!, via: 'cookie' })

  try {
    const now = clock.now()
    for (const c of candidates) {
      if (!isTokenShapeValid(c.token)) continue
      const s = await findSessionByToken(c.token)
      if (!s || !isSessionAlive(s, now)) continue
      if (s.kind === 'admin' && s.admin) {
        const locale = req.locale
        req.admin = {
          adminId: s.admin.id,
          username: s.admin.username,
          sessionId: s.id,
          requestId: req.requestId,
          locale,
          t: createT(locale),
          ip: req.ip,
        }
        req.authVia = c.via
        await touchSession(s)
        continue
      }
      if (s.user && s.tenant && s.tenantId) {
        if (
          !s.user.isActive ||
          s.user.deletedAt ||
          s.tenant.status === 'closed' ||
          s.tenant.deletedAt
        )
          continue
        const locale = resolveLocale(s.user.locale, s.tenant.locale)
        req.ctx = {
          tenantId: s.tenantId,
          userId: s.user.id,
          role: s.user.role,
          sessionId: s.id,
          requestId: req.requestId,
          locale,
          t: createT(locale),
          ip: req.ip,
        }
        req.authVia = req.authVia === 'cookie' ? 'cookie' : c.via
        await touchSession(s)
      }
    }
    next()
  } catch (err) {
    next(err)
  }
}
