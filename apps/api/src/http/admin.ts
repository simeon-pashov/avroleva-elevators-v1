import { Router } from 'express'
import {
  adminLoginBody,
  adminUpdateTenantBody,
  registerTenantBody,
  setPasswordBody,
} from '@avroleva/contracts'
import type { AdminTenantDto } from '@avroleva/contracts'
import { ADMIN_COOKIE, adminActorOf, adminOf, requireAdmin } from '../platform/http/ctx.js'
import { parseBody, parseId } from '../platform/http/validate.js'
import * as tenancy from '../modules/tenancy/index.js'
import * as registry from '../modules/registry/index.js'

/**
 * Platform-admin facade (L4 http/admin). Talks to tenancy and registry through their index.ts only.
 * Admin sessions use their own cookie so an admin and a tenant user can be logged in side by side.
 */
export const adminRouter = Router()

adminRouter.post('/admin/auth/login', tenancy.loginLimiter, async (req, res) => {
  const body = parseBody(adminLoginBody, req)
  const r = await tenancy.adminLogin(body.username, body.password, {
    ip: req.ip,
    requestId: req.requestId,
  })
  res.cookie(ADMIN_COOKIE, r.token, tenancy.sessionCookieOptions(r.expiresAt))
  res.json({ admin: r.admin, token: r.token })
})

adminRouter.post('/admin/auth/logout', async (req, res) => {
  if (req.admin) await tenancy.logout(req.admin.sessionId)
  tenancy.clearCookie(res, ADMIN_COOKIE)
  res.status(204).end()
})

adminRouter.use('/admin', requireAdmin)

adminRouter.get('/admin/auth/me', (req, res) => {
  const a = adminOf(req)
  res.json({ admin: { id: a.adminId, username: a.username } })
})

async function withCounts(
  tenant: Awaited<ReturnType<typeof tenancy.adminListTenants>>[number],
): Promise<AdminTenantDto> {
  const [c, users] = await Promise.all([
    registry.counts(tenant.id),
    tenancy.adminGetTenant(tenant.id),
  ])
  return { ...tenant, counts: { ...c, users: users.users.length } }
}

adminRouter.get('/admin/tenants', async (_req, res) => {
  const tenants = await tenancy.adminListTenants()
  res.json({ items: await Promise.all(tenants.map(withCounts)) })
})

adminRouter.post('/admin/tenants', async (req, res) => {
  const r = await tenancy.registerTenant(
    adminActorOf(adminOf(req)),
    parseBody(registerTenantBody, req),
  )
  res.status(201).json({ tenant: await withCounts(r.tenant), users: r.users })
})

adminRouter.get('/admin/tenants/:id', async (req, res) => {
  const r = await tenancy.adminGetTenant(parseId(req))
  res.json({ tenant: await withCounts(r.tenant), users: r.users })
})

adminRouter.patch('/admin/tenants/:id', async (req, res) => {
  const t = await tenancy.adminUpdateTenant(
    adminActorOf(adminOf(req)),
    parseId(req),
    parseBody(adminUpdateTenantBody, req),
  )
  res.json(await withCounts(t))
})

/** Cancels a scheduled deletion at the owner's written request (audited as platformAdmin). */
adminRouter.post('/admin/tenants/:id/cancel-deletion', async (req, res) => {
  const t = await tenancy.adminCancelDeletion(adminActorOf(adminOf(req)), parseId(req))
  res.json(await withCounts(t))
})

adminRouter.post('/admin/tenants/:id/users/:userId/password', async (req, res) => {
  await tenancy.adminResetUserPassword(
    adminActorOf(adminOf(req)),
    parseId(req),
    parseId(req, 'userId'),
    parseBody(setPasswordBody, req).password,
  )
  res.status(204).end()
})
