import type {
  AccessLinkStatusDto,
  BuildingAccessLinkDto,
  CreateAccessLinkBody,
  SendAccessLinkBody,
  SendAccessLinkResultDto,
} from '@avroleva/contracts'
import { ACCESS_LINK_DEFAULT_MONTHS } from '@avroleva/contracts'
import { formatDate } from '@avroleva/i18n'
import type { T } from '@avroleva/i18n'
import type { Ctx } from '../../platform/http/ctx.js'
import { actorOf, systemActorOf } from '../../platform/http/ctx.js'
import { AppError, notFound } from '../../platform/http/errors.js'
import { audit } from '../../platform/audit.js'
import { clock } from '../../platform/clock.js'
import { config } from '../../platform/config.js'
import { createT } from '../../platform/i18n.js'
import { newAccessToken } from '../../platform/ids.js'
import { urls } from '../../platform/urls.js'
import { findUsersByIds, getTenant } from '../tenancy/index.js'
import { buildings } from '../registry/index.js'
import * as repo from './repo/accessLinks.js'
import type { AccessLinkRow } from './repo/accessLinks.js'
import {
  expiryFor,
  ipHash,
  isAccessTokenShape,
  linkState,
  rotatedExpiry,
  viberForwardUrl,
} from './domain/accessLink.js'
import { statementLinkNotifier } from './domain/ports.js'

/**
 * Building access links (step 9): a 128-bit token that opens `/s/:token`, the building's
 * statement page, without a login. The office generates, rotates, revokes and sends them;
 * dunning e-mails and reports pick the newest active one up (creating one when needed). Every
 * generation / rotation / revocation / send is audited; opens are only counted on the row.
 */
const ENTITY = 'building_access_link'
const TEMPLATE_KEY = 'statement_link'

interface DtoContext {
  tenantName: string
  locale: string
  t: T
  addressText: string
  names: Map<string, string>
  now: Date
}

function toDto(r: AccessLinkRow, o: DtoContext): BuildingAccessLinkDto {
  const url = urls.statementPage(r.token)
  const params = {
    tenant: o.tenantName,
    address: o.addressText,
    url,
    expires: formatDate(r.expiresAt, o.locale),
  }
  return {
    id: r.id,
    buildingId: r.buildingId,
    scope: r.scope,
    url,
    viberUrl: viberForwardUrl(o.t('accessLinks.viberText', params)),
    emailSubject: o.t('accessLinks.emailSubject', params),
    emailBody: o.t('accessLinks.emailBody', params),
    createdAt: r.createdAt.toISOString(),
    createdByName: r.createdBy ? (o.names.get(r.createdBy) ?? null) : null,
    expiresAt: r.expiresAt.toISOString(),
    revokedAt: r.revokedAt ? r.revokedAt.toISOString() : null,
    lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
    useCount: r.useCount,
    state: linkState(r, o.now),
  }
}

async function toDtos(
  tenantId: string,
  rows: AccessLinkRow[],
  addressText: string,
): Promise<BuildingAccessLinkDto[]> {
  const tenant = await getTenant(tenantId)
  const ids = [...new Set(rows.map((r) => r.createdBy).filter((x): x is string => !!x))]
  const users = await findUsersByIds(tenantId, ids)
  const o: DtoContext = {
    tenantName: tenant.name,
    locale: tenant.locale,
    t: createT(tenant.locale),
    addressText,
    names: new Map(users.map((u) => [u.id, u.name])),
    now: clock.now(),
  }
  return rows.map((r) => toDto(r, o))
}

/** 404 for a foreign or missing building (no existence leak, ARCHITECTURE section 5). */
async function buildingOf(tenantId: string, buildingId: string) {
  const b = await buildings.find(tenantId, buildingId)
  if (!b) throw notFound()
  return b
}

async function linkOf(tenantId: string, buildingId: string, linkId: string) {
  const row = await repo.find(tenantId, buildingId, linkId)
  if (!row) throw notFound()
  return row
}

export async function listLinks(ctx: Ctx, buildingId: string): Promise<BuildingAccessLinkDto[]> {
  const b = await buildingOf(ctx.tenantId, buildingId)
  return toDtos(ctx.tenantId, await repo.listForBuilding(ctx.tenantId, buildingId), b.addressText)
}

export async function createLink(
  ctx: Ctx,
  buildingId: string,
  body: CreateAccessLinkBody,
): Promise<BuildingAccessLinkDto> {
  const b = await buildingOf(ctx.tenantId, buildingId)
  const row = await repo.create(ctx.tenantId, {
    buildingId,
    token: newAccessToken(),
    scope: body.scope,
    createdBy: ctx.userId || null,
    expiresAt: expiryFor(clock.now(), body.expiresInMonths),
  })
  await audit(actorOf(ctx), {
    action: 'accessLink.create',
    entityType: ENTITY,
    entityId: row.id,
    after: { buildingId, scope: row.scope, expiresAt: row.expiresAt.toISOString() },
  })
  return (await toDtos(ctx.tenantId, [row], b.addressText))[0]!
}

/** Revokes the old link and issues a new one with the same scope; the longer validity wins. */
export async function rotateLink(
  ctx: Ctx,
  buildingId: string,
  linkId: string,
): Promise<BuildingAccessLinkDto> {
  const b = await buildingOf(ctx.tenantId, buildingId)
  const old = await linkOf(ctx.tenantId, buildingId, linkId)
  const now = clock.now()
  if (!old.revokedAt)
    await repo.revoke(ctx.tenantId, old.id, { revokedAt: now, revokedBy: ctx.userId || null })
  const row = await repo.create(ctx.tenantId, {
    buildingId,
    token: newAccessToken(),
    scope: old.scope,
    createdBy: ctx.userId || null,
    expiresAt: rotatedExpiry(old.expiresAt, now, ACCESS_LINK_DEFAULT_MONTHS),
  })
  await audit(actorOf(ctx), {
    action: 'accessLink.rotate',
    entityType: ENTITY,
    entityId: row.id,
    before: { linkId: old.id },
    after: { buildingId, scope: row.scope, expiresAt: row.expiresAt.toISOString() },
  })
  return (await toDtos(ctx.tenantId, [row], b.addressText))[0]!
}

export async function revokeLink(
  ctx: Ctx,
  buildingId: string,
  linkId: string,
): Promise<BuildingAccessLinkDto> {
  const b = await buildingOf(ctx.tenantId, buildingId)
  const row = await linkOf(ctx.tenantId, buildingId, linkId)
  if (row.revokedAt) return (await toDtos(ctx.tenantId, [row], b.addressText))[0]!
  const updated = await repo.revoke(ctx.tenantId, row.id, {
    revokedAt: clock.now(),
    revokedBy: ctx.userId || null,
  })
  await audit(actorOf(ctx), {
    action: 'accessLink.revoke',
    entityType: ENTITY,
    entityId: row.id,
    after: { buildingId, revokedAt: updated.revokedAt?.toISOString() ?? null },
  })
  return (await toDtos(ctx.tenantId, [updated], b.addressText))[0]!
}

/**
 * Sends the link through the `statement_link` template: e-mail to the given address or the
 * building's primary contact, or a Viber deep link for the office user's phone. Building (L3)
 * reaches notifications (L4) only through the StatementLinkNotifier port.
 */
export async function sendLink(
  ctx: Ctx,
  buildingId: string,
  linkId: string,
  body: SendAccessLinkBody,
): Promise<SendAccessLinkResultDto> {
  const b = await buildingOf(ctx.tenantId, buildingId)
  const row = await linkOf(ctx.tenantId, buildingId, linkId)
  if (linkState(row, clock.now()) !== 'active') throw new AppError(409, 'accessLinks.notActive')
  const [detail, tenant] = await Promise.all([
    buildings.get(ctx, buildingId),
    getTenant(ctx.tenantId),
  ])
  const dto = (await toDtos(ctx.tenantId, [row], b.addressText))[0]!
  const contacts = detail.contacts
  const data: Record<string, unknown> = {
    tenant,
    building: {
      id: buildingId,
      addressText: b.addressText,
      customerName: detail.customerName ?? '',
    },
    contact: { name: '', email: '', phone: '' },
    statementLink: {
      url: dto.url,
      expiresAt: row.expiresAt.toISOString(),
      message: body.message ?? '',
    },
  }
  let notificationId: string | null = null
  let viber: SendAccessLinkResultDto['viber'] = null
  let to: string
  if (body.channel === 'email') {
    const contact = body.email
      ? null
      : (contacts.find((c) => c.isPrimary && c.email) ?? contacts.find((c) => c.email) ?? null)
    const email = body.email ?? contact?.email ?? null
    if (!email) throw new AppError(400, 'accessLinks.noEmail')
    to = email
    data.contact = { name: contact?.name ?? '', email, phone: contact?.phone ?? '' }
    const n = await statementLinkNotifier().sendEmail(ctx.tenantId, {
      key: TEMPLATE_KEY,
      to: email,
      data,
      relatedType: 'building',
      relatedId: buildingId,
      locale: tenant.locale,
    })
    notificationId = n.id
  } else {
    const contact = body.phone
      ? null
      : (contacts.find((c) => c.hasViber && c.phone) ?? contacts.find((c) => c.phone) ?? null)
    const phone = body.phone ?? contact?.phone ?? null
    if (!phone) throw new AppError(400, 'accessLinks.noPhone')
    to = phone
    data.contact = { name: contact?.name ?? '', email: contact?.email ?? '', phone }
    const v = await statementLinkNotifier().viberLink(ctx.tenantId, {
      key: TEMPLATE_KEY,
      phone,
      data,
      relatedType: 'building',
      relatedId: buildingId,
      locale: tenant.locale,
    })
    notificationId = v.id
    viber = { url: v.url, text: v.text }
  }
  await audit(actorOf(ctx), {
    action: 'accessLink.send',
    entityType: ENTITY,
    entityId: row.id,
    after: { buildingId, channel: body.channel, to, notificationId },
  })
  return { link: dto, notificationId, viber }
}

/** What the building page / elevator panel show at a glance (no money in it). */
export async function linkStatus(
  tenantId: string,
  buildingId: string,
): Promise<AccessLinkStatusDto> {
  await buildingOf(tenantId, buildingId)
  const row = await repo.newestActive(tenantId, buildingId, clock.now())
  return {
    buildingId,
    active: !!row,
    linkId: row?.id ?? null,
    scope: row?.scope ?? null,
    expiresAt: row ? row.expiresAt.toISOString() : null,
    lastUsedAt: row?.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    useCount: row?.useCount ?? 0,
  }
}

/**
 * URL of the newest active link, for dunning e-mails and reports. With `create`, a `statement`
 * link is generated by the system when none is active (audit `accessLink.autoCreate`). Null when
 * the building is unknown, so a notification never fails because of the link.
 */
export async function activeLinkUrl(
  tenantId: string,
  buildingId: string,
  opts: { create?: boolean } = {},
): Promise<string | null> {
  if (!(await buildings.find(tenantId, buildingId))) return null
  const now = clock.now()
  const existing = await repo.newestActive(tenantId, buildingId, now)
  if (existing) return urls.statementPage(existing.token)
  if (!opts.create) return null
  const row = await repo.create(tenantId, {
    buildingId,
    token: newAccessToken(),
    scope: 'statement',
    createdBy: null,
    expiresAt: expiryFor(now, ACCESS_LINK_DEFAULT_MONTHS),
  })
  await audit(systemActorOf(tenantId), {
    action: 'accessLink.autoCreate',
    entityType: ENTITY,
    entityId: row.id,
    after: { buildingId, scope: row.scope, expiresAt: row.expiresAt.toISOString() },
  })
  return urls.statementPage(row.token)
}

// ---- The public page's side ------------------------------------------------------------------

export interface ResolvedAccessLink {
  id: string
  tenantId: string
  buildingId: string
  token: string
  scope: AccessLinkRow['scope']
  expiresAt: Date
  addressText: string
}

/** Token -> active link of a live building, else null (missing, revoked, expired: all alike). */
export async function resolveAccessLink(token: string): Promise<ResolvedAccessLink | null> {
  if (!isAccessTokenShape(token)) return null
  const row = await repo.findByToken(token)
  if (!row || row.building.deletedAt) return null
  if (linkState(row, clock.now()) !== 'active') return null
  return {
    id: row.id,
    tenantId: row.tenantId,
    buildingId: row.buildingId,
    token: row.token,
    scope: row.scope,
    expiresAt: row.expiresAt,
    addressText: row.building.addressText,
  }
}

/**
 * Counts an open on the row (`useCount`, `lastUsedAt`, keyed IP hash). Opens are not audited;
 * writes are throttled to one per link per minute, the opens in between are accumulated in
 * memory and land with the next write.
 */
const OPEN_FLUSH_MS = 60 * 1000
const opens = new Map<string, { lastWriteMs: number; pending: number }>()

export async function recordOpen(link: ResolvedAccessLink, ip: string | undefined): Promise<void> {
  const now = clock.now()
  if (opens.size > 5000) opens.clear()
  const e = opens.get(link.id) ?? { lastWriteMs: 0, pending: 0 }
  e.pending += 1
  opens.set(link.id, e)
  if (now.getTime() - e.lastWriteMs < OPEN_FLUSH_MS) return
  const count = e.pending
  e.pending = 0
  e.lastWriteMs = now.getTime()
  await repo.touchUse(link.tenantId, link.id, {
    count,
    at: now,
    ipHash: ipHash(ip, config.SESSION_SECRET),
  })
}

/** Test hook: expires every throttle window so the next open flushes what is pending. */
export function resetOpenThrottle(): void {
  for (const e of opens.values()) e.lastWriteMs = 0
}
