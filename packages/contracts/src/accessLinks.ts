import { z } from 'zod'
import { phone } from './common.js'

/**
 * Step 9: the building's magic link (`/s/:token`): a 128-bit token, no login, that opens the
 * building's statement (balance, open invoices with EPC QR, payment history) and, with the wider
 * scope, the last 12 months of visits / callbacks / defects and the next inspection. Generated,
 * rotated and revoked by the office; every open is counted (IP hash only).
 */
export const AccessLinkScope = z.enum(['statement', 'statement_and_visits'])
export type AccessLinkScope = z.infer<typeof AccessLinkScope>

export const ACCESS_LINK_DEFAULT_MONTHS = 12

export const createAccessLinkBody = z.object({
  scope: AccessLinkScope.default('statement'),
  /** Validity in months from now (default 12). */
  expiresInMonths: z.number().int().min(1).max(60).default(ACCESS_LINK_DEFAULT_MONTHS),
})
export type CreateAccessLinkBody = z.infer<typeof createAccessLinkBody>

export const sendAccessLinkBody = z.object({
  channel: z.enum(['email', 'viber']),
  email: z.email().optional(),
  phone: phone.optional(),
  /** Optional line added above the standard text. */
  message: z.string().trim().max(1000).optional(),
})
export type SendAccessLinkBody = z.infer<typeof sendAccessLinkBody>

export interface BuildingAccessLinkDto {
  id: string
  buildingId: string
  scope: AccessLinkScope
  /** Absolute public URL (`<PUBLIC_BASE_URL><BASE_PATH>/s/<token>`). */
  url: string
  /** `viber://forward?text=...` with the standard text and the URL. */
  viberUrl: string
  /** The e-mail template rendered for a mail client ("Вашата справка"). */
  emailSubject: string
  emailBody: string
  createdAt: string
  createdByName: string | null
  expiresAt: string
  revokedAt: string | null
  lastUsedAt: string | null
  useCount: number
  /** active = not revoked and not expired. */
  state: 'active' | 'expired' | 'revoked'
}

export interface SendAccessLinkResultDto {
  link: BuildingAccessLinkDto
  notificationId: string | null
  /** For the viber channel: the deep link to open on the office phone / desktop client. */
  viber: { url: string; text: string } | null
}

/** What the elevator panel / building page show at a glance. */
export interface AccessLinkStatusDto {
  buildingId: string
  active: boolean
  linkId: string | null
  scope: AccessLinkScope | null
  expiresAt: string | null
  lastUsedAt: string | null
  useCount: number
}
