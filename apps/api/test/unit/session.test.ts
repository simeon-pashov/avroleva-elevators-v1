import { describe, expect, it } from 'vitest'
import {
  BROWSER_SESSION_MS,
  RENEW_AFTER_MS,
  generateToken,
  hashToken,
  isSessionAlive,
  isTokenShapeValid,
  sessionTtlMs,
  shouldRenew,
} from '../../src/modules/tenancy/domain/session.js'

describe('session tokens', () => {
  it('generates opaque tokens whose sha256 is what gets stored', () => {
    const { token, tokenHash } = generateToken()
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(tokenHash).toBe(hashToken(token))
    expect(tokenHash).toHaveLength(64)
    expect(generateToken().token).not.toBe(token)
    expect(isTokenShapeValid(token)).toBe(true)
    expect(isTokenShapeValid('short')).toBe(false)
  })

  it('30-day sliding for browsers, longer for devices', () => {
    expect(sessionTtlMs('browser')).toBe(BROWSER_SESSION_MS)
    expect(sessionTtlMs('device')).toBeGreaterThan(BROWSER_SESSION_MS)
  })

  it('alive/expired/revoked and renewal window', () => {
    const now = new Date('2026-09-08T10:00:00Z')
    expect(
      isSessionAlive({ expiresAt: new Date(now.getTime() + 1000), revokedAt: null }, now),
    ).toBe(true)
    expect(
      isSessionAlive({ expiresAt: new Date(now.getTime() - 1000), revokedAt: null }, now),
    ).toBe(false)
    expect(isSessionAlive({ expiresAt: new Date(now.getTime() + 1000), revokedAt: now }, now)).toBe(
      false,
    )
    expect(shouldRenew({ lastSeenAt: new Date(now.getTime() - RENEW_AFTER_MS - 1) }, now)).toBe(
      true,
    )
    expect(shouldRenew({ lastSeenAt: new Date(now.getTime() - 1000) }, now)).toBe(false)
  })
})
