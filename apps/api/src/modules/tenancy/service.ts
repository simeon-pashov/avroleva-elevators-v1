import { createHash, randomBytes } from 'node:crypto'
import QRCode from 'qrcode'
import type {
  AdminUpdateTenantBody,
  CreateUserBody,
  EnrollBody,
  EnrollResponse,
  EnrollmentTokenDto,
  MeDto,
  SessionDto,
  RegisterTenantBody,
  TenantDto,
  TenantFeatures,
  TenantSettings,
  UpdateMeBody,
  UpdateTenantBody,
  UpdateUserBody,
  UserDto,
} from '@avroleva/contracts'
import { ENROLLMENT_TOKEN_TTL_MS } from '@avroleva/contracts'
import { resolveLocale } from '@avroleva/i18n'
import { prismaBase, transaction } from '../../platform/db/prisma.js'
import { urls } from '../../platform/urls.js'
import { AppError, conflict, notFound, unauthorized } from '../../platform/http/errors.js'
import { audit } from '../../platform/audit.js'
import type { AuditActor } from '../../platform/audit.js'
import { events } from '../../platform/events/bus.js'
import { clock } from '../../platform/clock.js'
import { hashPassword, verifyPassword, burnCompare } from './domain/password.js'
import { parseFeatures, parseSettings, toTenantDto, toUserDto } from './domain/mappers.js'
import * as users from './repo/users.js'
import * as tenants from './repo/tenants.js'
import * as sessions from './repo/sessions.js'
import * as admins from './repo/admins.js'
import * as enrollment from './repo/enrollment.js'
import type { Ctx } from '../../platform/http/ctx.js'

const cleanEmail = (e: string | null | undefined) => (e ? e : null)

// ---- Auth -----------------------------------------------------------------------------------

export interface LoginResult extends MeDto {
  token: string
  sessionId: string
  expiresAt: Date
}

export async function login(
  username: string,
  password: string,
  meta: { ip?: string; kind?: 'browser' | 'device'; requestId?: string },
): Promise<LoginResult> {
  const user = await users.findUserByUsername(username)
  if (
    !user ||
    user.deletedAt ||
    !user.isActive ||
    user.tenant.status === 'closed' ||
    user.tenant.deletedAt
  ) {
    await burnCompare(password)
    throw unauthorized('auth.invalidCredentials')
  }
  const ok = await verifyPassword(password, user.passwordHash)
  if (!ok) throw unauthorized('auth.invalidCredentials')

  const session = await sessions.createSession({
    kind: meta.kind ?? 'browser',
    tenantId: user.tenantId,
    userId: user.id,
    ip: meta.ip,
  })
  await users.updateUser(user.tenantId, user.id, { lastLoginAt: clock.now() })
  await audit(
    {
      tenantId: user.tenantId,
      actorType: 'user',
      actorId: user.id,
      requestId: meta.requestId,
      ip: meta.ip,
    },
    { action: 'auth.login', entityType: 'session', entityId: session.id },
  )
  return {
    user: toUserDto(user),
    tenant: toTenantDto(user.tenant),
    locale: resolveLocale(user.locale, user.tenant.locale),
    token: session.token,
    sessionId: session.id,
    expiresAt: session.expiresAt,
  }
}

export async function logout(sessionId: string): Promise<void> {
  await sessions.revokeSession(sessionId)
}

export async function me(ctx: Ctx): Promise<MeDto> {
  const [user, tenant] = await Promise.all([
    users.findUser(ctx.tenantId, ctx.userId),
    tenants.findTenant(ctx.tenantId),
  ])
  if (!user || !tenant) throw unauthorized('auth.required')
  return {
    user: toUserDto(user),
    tenant: toTenantDto(tenant),
    locale: resolveLocale(user.locale, tenant.locale),
  }
}

export async function updateMe(ctx: Ctx, body: UpdateMeBody): Promise<MeDto> {
  await users.updateUser(ctx.tenantId, ctx.userId, {
    ...(body.locale !== undefined ? { locale: body.locale } : {}),
    ...(body.name !== undefined ? { name: body.name } : {}),
  })
  return me(ctx)
}

// ---- Tenant settings --------------------------------------------------------------------------

export async function getTenant(tenantId: string): Promise<TenantDto> {
  const t = await tenants.findTenant(tenantId)
  if (!t) throw notFound()
  return toTenantDto(t)
}

/** Used by registry (L2 -> L1) for the default check interval. */
export async function getTenantSettings(tenantId: string): Promise<TenantSettings> {
  const t = await tenants.findTenant(tenantId)
  return parseSettings(t?.settings)
}

/** Feature flags (ARCHITECTURE A7) for the facades; a missing tenant reads as "everything off". */
export async function getTenantFeatures(tenantId: string): Promise<TenantFeatures> {
  const t = await tenants.findTenant(tenantId)
  return parseFeatures(t?.features)
}

export async function updateTenant(ctx: Ctx, body: UpdateTenantBody): Promise<TenantDto> {
  const current = await tenants.findTenant(ctx.tenantId)
  if (!current) throw notFound()
  const settings = { ...parseSettings(current.settings), ...(body.settings ?? {}) }
  const features = { ...parseFeatures(current.features), ...(body.features ?? {}) }
  const updated = await tenants.updateTenant(ctx.tenantId, {
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.eik !== undefined ? { eik: body.eik } : {}),
    ...(body.vatNo !== undefined ? { vatNo: body.vatNo } : {}),
    ...(body.address !== undefined ? { address: body.address } : {}),
    ...(body.phone !== undefined ? { phone: body.phone } : {}),
    ...(body.emergencyPhone !== undefined ? { emergencyPhone: body.emergencyPhone } : {}),
    ...(body.email !== undefined ? { email: cleanEmail(body.email) } : {}),
    ...(body.locale !== undefined ? { locale: body.locale } : {}),
    settings,
    features,
  })
  await audit(actorOfCtx(ctx), {
    action: 'tenant.update',
    entityType: 'tenant',
    entityId: ctx.tenantId,
    before: { settings: current.settings, features: current.features, locale: current.locale },
    after: { settings, features, locale: updated.locale },
  })
  if (
    body.settings &&
    JSON.stringify(settings) !== JSON.stringify(parseSettings(current.settings))
  ) {
    // Registry (L2) recomputes nextCheckDueAt on this; it must not be called from here (L1).
    await events.publish(ctx, {
      type: 'TenantSettingsChanged',
      aggregateType: 'tenant',
      aggregateId: ctx.tenantId,
      payload: { settings },
    })
  }
  return toTenantDto(updated)
}

/** Name lookup for other modules (visits snapshots the technician names). */
export async function findUsersByIds(
  tenantId: string,
  ids: string[],
): Promise<Array<{ id: string; name: string; role: string; isActive: boolean }>> {
  if (ids.length === 0) return []
  return users.findUsersByIds(tenantId, ids)
}

// ---- Users (owner) ---------------------------------------------------------------------------

export async function listUsers(ctx: Ctx): Promise<UserDto[]> {
  return (await users.listUsers(ctx.tenantId)).map(toUserDto)
}

export async function createUser(ctx: Ctx, body: CreateUserBody): Promise<UserDto> {
  if (await users.usernameTaken(body.username)) throw conflict('users.usernameTaken')
  const user = await users.createUser({
    tenantId: ctx.tenantId,
    username: body.username,
    passwordHash: await hashPassword(body.password),
    name: body.name,
    role: body.role,
    email: cleanEmail(body.email),
    phone: body.phone || null,
    locale: body.locale ?? null,
  })
  await audit(actorOfCtx(ctx), {
    action: 'user.create',
    entityType: 'user',
    entityId: user.id,
    after: { role: user.role },
  })
  await events.publish(ctx, {
    type: 'UserCreated',
    aggregateType: 'user',
    aggregateId: user.id,
    payload: { role: user.role },
  })
  return toUserDto(user)
}

export async function updateUser(ctx: Ctx, id: string, body: UpdateUserBody): Promise<UserDto> {
  const existing = await users.findUser(ctx.tenantId, id)
  if (!existing) throw notFound()
  const demotingOrDeactivatingOwner =
    existing.role === 'owner' && ((body.role && body.role !== 'owner') || body.isActive === false)
  if (demotingOrDeactivatingOwner && (await users.countOwners(ctx.tenantId)) <= 1) {
    throw new AppError(409, 'users.lastOwner')
  }
  if (id === ctx.userId && body.isActive === false)
    throw new AppError(409, 'users.cannotDeactivateSelf')
  const updated = await users.updateUser(ctx.tenantId, id, {
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.role !== undefined ? { role: body.role } : {}),
    ...(body.email !== undefined ? { email: cleanEmail(body.email) } : {}),
    ...(body.phone !== undefined ? { phone: body.phone || null } : {}),
    ...(body.locale !== undefined ? { locale: body.locale } : {}),
    ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
  })
  if (body.isActive === false) {
    await sessions.revokeUserSessions(ctx.tenantId, id)
    await events.publish(ctx, {
      type: 'UserDeactivated',
      aggregateType: 'user',
      aggregateId: id,
      payload: {},
    })
  }
  await audit(actorOfCtx(ctx), {
    action: 'user.update',
    entityType: 'user',
    entityId: id,
    before: { role: existing.role, isActive: existing.isActive },
    after: { role: updated.role, isActive: updated.isActive },
  })
  return toUserDto(updated)
}

export async function setUserPassword(ctx: Ctx, id: string, password: string): Promise<void> {
  const existing = await users.findUser(ctx.tenantId, id)
  if (!existing) throw notFound()
  await users.updateUser(ctx.tenantId, id, { passwordHash: await hashPassword(password) })
  if (id !== ctx.userId) await sessions.revokeUserSessions(ctx.tenantId, id)
  await audit(actorOfCtx(ctx), { action: 'user.setPassword', entityType: 'user', entityId: id })
}

// ---- Device enrollment & sessions (technician app) -------------------------------------------

const hashCode = (code: string) => createHash('sha256').update(code).digest('hex')

/**
 * One-time enrollment code for a technician (owner/office). 10 minutes, single use, shown as a QR
 * that opens the tech app with `?enroll=<code>` - no typing on the phone (ARCHITECTURE section 5).
 */
export async function createEnrollmentToken(ctx: Ctx, userId: string): Promise<EnrollmentTokenDto> {
  const user = await users.findUser(ctx.tenantId, userId)
  if (!user || !user.isActive) throw notFound()
  const code = randomBytes(24).toString('base64url')
  const expiresAt = new Date(clock.now().getTime() + ENROLLMENT_TOKEN_TTL_MS)
  await enrollment.createEnrollmentToken({
    tenantId: ctx.tenantId,
    userId: user.id,
    codeHash: hashCode(code),
    expiresAt,
    createdByUserId: ctx.userId,
  })
  const url = urls.techEnroll(code)
  const qrSvg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
  await audit(actorOfCtx(ctx), {
    action: 'device.enrollToken',
    entityType: 'user',
    entityId: user.id,
  })
  return {
    userId: user.id,
    userName: user.name,
    token: code,
    expiresAt: expiresAt.toISOString(),
    url,
    qrSvg,
  }
}

/** The phone exchanges the code for a device session (Bearer, 180 days sliding). */
export async function enrollDevice(
  body: EnrollBody,
  meta: { ip?: string; requestId?: string },
): Promise<EnrollResponse> {
  const now = clock.now()
  const row = await enrollment.findEnrollmentByHash(hashCode(body.token))
  if (!row || row.usedAt || row.expiresAt.getTime() < now.getTime())
    throw unauthorized('auth.enrollInvalid')
  const user = row.user
  if (
    !user ||
    user.deletedAt ||
    !user.isActive ||
    user.tenant.status === 'closed' ||
    user.tenant.deletedAt
  )
    throw unauthorized('auth.enrollInvalid')
  if (!(await enrollment.consumeEnrollment(row.tenantId, row.id, now)))
    throw unauthorized('auth.enrollInvalid')
  const session = await sessions.createSession({
    kind: 'device',
    tenantId: user.tenantId,
    userId: user.id,
    ip: meta.ip,
    deviceName: body.deviceName,
  })
  if (body.clientVersion)
    await enrollment.updateSessionClient(session.id, { clientVersion: body.clientVersion })
  await users.updateUser(user.tenantId, user.id, { lastLoginAt: now })
  await audit(
    {
      tenantId: user.tenantId,
      actorType: 'user',
      actorId: user.id,
      requestId: meta.requestId,
      ip: meta.ip,
    },
    {
      action: 'device.enroll',
      entityType: 'session',
      entityId: session.id,
      after: { deviceName: body.deviceName, clientVersion: body.clientVersion ?? null },
    },
  )
  return {
    user: toUserDto(user),
    tenant: toTenantDto(user.tenant),
    locale: resolveLocale(user.locale, user.tenant.locale),
    token: session.token,
    sessionId: session.id,
    expiresAt: session.expiresAt.toISOString(),
  }
}

/** Owner view: every live browser/device session of the firm (revoke = "sign out this phone"). */
export async function listSessions(ctx: Ctx): Promise<SessionDto[]> {
  const rows = await enrollment.listSessions(ctx.tenantId, clock.now())
  return rows.map((s) => ({
    id: s.id,
    userId: s.userId ?? '',
    userName: s.user?.name ?? '',
    kind: s.kind === 'device' ? 'device' : 'browser',
    deviceName: s.deviceName,
    clientVersion: s.clientVersion,
    createdAt: s.createdAt.toISOString(),
    lastSeenAt: s.lastSeenAt.toISOString(),
    expiresAt: s.expiresAt.toISOString(),
    current: s.id === ctx.sessionId,
  }))
}

export async function revokeSessionById(ctx: Ctx, id: string): Promise<void> {
  const s = await enrollment.findSession(ctx.tenantId, id)
  if (!s) throw notFound()
  await sessions.revokeSession(id)
  await audit(actorOfCtx(ctx), {
    action: 'session.revoke',
    entityType: 'session',
    entityId: id,
    before: { userId: s.userId, kind: s.kind, deviceName: s.deviceName },
  })
}

/** Sync facade: remember the app version a device runs (X-Client-Version). Best effort. */
export async function noteClientVersion(sessionId: string, version: string): Promise<void> {
  try {
    await enrollment.updateSessionClient(sessionId, { clientVersion: version })
  } catch {
    /* best effort */
  }
}

// ---- Platform admin ---------------------------------------------------------------------------

export async function adminLogin(
  username: string,
  password: string,
  meta: { ip?: string; requestId?: string },
): Promise<{
  token: string
  sessionId: string
  expiresAt: Date
  admin: { id: string; username: string }
}> {
  const admin = await admins.findAdminByUsername(username)
  if (!admin) {
    await burnCompare(password)
    throw unauthorized('auth.invalidCredentials')
  }
  if (!(await verifyPassword(password, admin.passwordHash)))
    throw unauthorized('auth.invalidCredentials')
  const session = await sessions.createSession({ kind: 'admin', adminId: admin.id, ip: meta.ip })
  await audit(
    {
      tenantId: null,
      actorType: 'platformAdmin',
      actorId: admin.id,
      requestId: meta.requestId,
      ip: meta.ip,
    },
    { action: 'admin.login', entityType: 'session', entityId: session.id },
  )
  return {
    token: session.token,
    sessionId: session.id,
    expiresAt: session.expiresAt,
    admin: { id: admin.id, username: admin.username },
  }
}

export async function ensurePlatformAdmin(username: string, password: string): Promise<void> {
  await admins.upsertAdmin(username, await hashPassword(password))
}

export interface TenantWithUsers {
  tenant: TenantDto
  users: UserDto[]
}

export async function registerTenant(
  actor: AuditActor,
  body: RegisterTenantBody,
): Promise<TenantWithUsers> {
  if (await users.usernameTaken(body.owner.username)) throw conflict('users.usernameTaken')
  if (await tenants.findTenantByEik(body.eik)) throw conflict('admin.eikTaken')
  const passwordHash = await hashPassword(body.owner.password)
  const result = await transaction(async (tx) => {
    const tenant = await tenants.createTenant(
      {
        name: body.name,
        eik: body.eik,
        address: body.address,
        phone: body.phone,
        emergencyPhone: body.emergencyPhone,
        email: cleanEmail(body.email),
        locale: body.locale,
        settings: parseSettings({}),
      },
      tx,
    )
    const owner = await users.createUser(
      {
        tenantId: tenant.id,
        username: body.owner.username,
        passwordHash,
        name: body.owner.name,
        role: 'owner',
        email: cleanEmail(body.owner.email),
        locale: null,
      },
      tx,
    )
    await audit(
      actor,
      {
        action: 'tenant.create',
        entityType: 'tenant',
        entityId: tenant.id,
        after: { name: tenant.name },
      },
      tx,
    )
    await events.publish(
      { tenantId: tenant.id, requestId: actor.requestId },
      {
        type: 'TenantCreated',
        aggregateType: 'tenant',
        aggregateId: tenant.id,
        payload: { name: tenant.name },
      },
      tx,
    )
    return { tenant, owner }
  })
  return { tenant: toTenantDto(result.tenant), users: [toUserDto(result.owner)] }
}

export async function adminListTenants(): Promise<TenantDto[]> {
  return (await tenants.listTenants()).map(toTenantDto)
}

export async function adminGetTenant(id: string): Promise<TenantWithUsers> {
  const t = await tenants.findTenant(id)
  if (!t) throw notFound()
  return { tenant: toTenantDto(t), users: (await users.listUsers(id)).map(toUserDto) }
}

export async function adminUpdateTenant(
  actor: AuditActor,
  id: string,
  body: AdminUpdateTenantBody,
): Promise<TenantDto> {
  const t = await tenants.findTenant(id)
  if (!t) throw notFound()
  const updated = await tenants.updateTenant(id, {
    ...(body.status !== undefined ? { status: body.status } : {}),
    ...(body.name !== undefined ? { name: body.name } : {}),
  })
  if (body.status === 'closed') {
    await prismaBase.session.updateMany({
      where: { tenantId: id, revokedAt: null },
      data: { revokedAt: clock.now() },
    })
  }
  await audit(actor, {
    action: 'tenant.adminUpdate',
    entityType: 'tenant',
    entityId: id,
    before: { status: t.status, name: t.name },
    after: { status: updated.status, name: updated.name },
  })
  return toTenantDto(updated)
}

export async function adminResetUserPassword(
  actor: AuditActor,
  tenantId: string,
  userId: string,
  password: string,
) {
  const user = await users.findUser(tenantId, userId)
  if (!user) throw notFound()
  await users.updateUser(tenantId, userId, { passwordHash: await hashPassword(password) })
  await sessions.revokeUserSessions(tenantId, userId)
  await audit(actor, { action: 'user.adminResetPassword', entityType: 'user', entityId: userId })
}

function actorOfCtx(ctx: Ctx): AuditActor {
  return {
    tenantId: ctx.tenantId,
    actorType: 'user',
    actorId: ctx.userId,
    requestId: ctx.requestId,
    ip: ctx.ip,
  }
}
