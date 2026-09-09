import { createHash } from 'node:crypto'

/**
 * Building access links (step 9, pure): a 128-bit token opens the building's statement page
 * without a login. State is derived, never stored: a row is active until it is revoked or its
 * expiry passes. Opens are counted with a keyed IP hash only (no personal data on the row).
 */
export type AccessLinkState = 'active' | 'expired' | 'revoked'

export interface AccessLinkLike {
  expiresAt: Date
  revokedAt: Date | null
}

export const ACCESS_TOKEN_RE = /^[0-9a-f]{32}$/

export function isAccessTokenShape(token: string): boolean {
  return ACCESS_TOKEN_RE.test(token)
}

export function linkState(row: AccessLinkLike, now: Date): AccessLinkState {
  if (row.revokedAt) return 'revoked'
  if (row.expiresAt.getTime() <= now.getTime()) return 'expired'
  return 'active'
}

/** `now` + N calendar months (clamped to the last day of the target month, like addMonths). */
export function expiryFor(now: Date, months: number): Date {
  const d = new Date(now.getTime())
  const day = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + months)
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, last))
  return d
}

/** Rotation keeps the remaining validity of the old link or 12 months, whichever is longer. */
export function rotatedExpiry(previous: Date, now: Date, defaultMonths: number): Date {
  const fallback = expiryFor(now, defaultMonths)
  return previous.getTime() > fallback.getTime() ? previous : fallback
}

/** Keyed hash of the visitor's IP: stable per (ip, secret), 32 hex chars, not reversible. */
export function ipHash(ip: string | undefined, secret: string): string {
  return createHash('sha256')
    .update(`${ip ?? ''}|${secret}`)
    .digest('hex')
    .slice(0, 32)
}

/** `viber://forward?text=…` with the standard text; the office user picks the chat. */
export function viberForwardUrl(text: string): string {
  return `viber://forward?text=${encodeURIComponent(text)}`
}
