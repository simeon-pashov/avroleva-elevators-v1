import { createHash, randomBytes } from 'node:crypto'

export const BROWSER_SESSION_MS = 30 * 24 * 60 * 60 * 1000 // 30 days sliding
export const DEVICE_SESSION_MS = 180 * 24 * 60 * 60 * 1000 // 180 days sliding (step 3)
export const ADMIN_SESSION_MS = 12 * 60 * 60 * 1000 // 12 hours sliding
/** Touch lastSeenAt/expiresAt at most this often to avoid a write per request. */
export const RENEW_AFTER_MS = 60 * 60 * 1000

/** Opaque token: 32 random bytes, base64url; only its sha256 is stored (ARCHITECTURE section 5). */
export function generateToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, tokenHash: hashToken(token) }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function isTokenShapeValid(token: string): boolean {
  return /^[A-Za-z0-9_-]{40,50}$/.test(token)
}

export function sessionTtlMs(kind: 'browser' | 'device' | 'admin'): number {
  return kind === 'device'
    ? DEVICE_SESSION_MS
    : kind === 'admin'
      ? ADMIN_SESSION_MS
      : BROWSER_SESSION_MS
}

export function isSessionAlive(s: { expiresAt: Date; revokedAt: Date | null }, now: Date): boolean {
  return !s.revokedAt && s.expiresAt.getTime() > now.getTime()
}

export function shouldRenew(s: { lastSeenAt: Date }, now: Date): boolean {
  return now.getTime() - s.lastSeenAt.getTime() > RENEW_AFTER_MS
}
