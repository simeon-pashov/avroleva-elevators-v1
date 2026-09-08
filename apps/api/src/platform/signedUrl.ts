import { createHmac, timingSafeEqual } from 'node:crypto'
import { SIGNED_URL_TTL_SECONDS } from '@avroleva/contracts'
import { config } from './config.js'
import { clock } from './clock.js'

/**
 * Signed file URLs (ARCHITECTURE section 5): `/files/:id?v=<variant>&exp=<unix>&sig=<hmac>`.
 * The signature binds the attachment id, the variant, the expiry AND the tenant, so a URL minted
 * for one tenant cannot be replayed against another tenant's row (the file route checks the
 * tenant of the row against the one in the signature). HMAC-SHA256 with SESSION_SECRET.
 */
export type FileVariant = 'full' | 'thumb'

function payload(id: string, variant: FileVariant, exp: number, tenantId: string): string {
  return `${id}|${variant}|${exp}|${tenantId}`
}

export function signFile(
  id: string,
  variant: FileVariant,
  exp: number,
  tenantId: string,
  secret: string = config.SESSION_SECRET,
): string {
  return createHmac('sha256', secret)
    .update(payload(id, variant, exp, tenantId))
    .digest('hex')
}

export function verifyFileSignature(
  id: string,
  variant: FileVariant,
  exp: number,
  tenantId: string,
  sig: string,
  now: Date = clock.now(),
  secret: string = config.SESSION_SECRET,
): boolean {
  if (!Number.isFinite(exp) || exp * 1000 < now.getTime()) return false
  const expected = Buffer.from(signFile(id, variant, exp, tenantId, secret), 'hex')
  const given = Buffer.from(sig, 'hex')
  return expected.length === given.length && timingSafeEqual(expected, given)
}

/** Relative URL (BASE_PATH-aware, A11) valid for 15 minutes. */
export function signedFileUrl(
  id: string,
  variant: FileVariant,
  tenantId: string,
  ttlSeconds: number = SIGNED_URL_TTL_SECONDS,
): string {
  const exp = Math.floor(clock.now().getTime() / 1000) + ttlSeconds
  const sig = signFile(id, variant, exp, tenantId)
  const base = config.BASE_PATH === '/' ? '' : config.BASE_PATH
  return `${base}/files/${id}?v=${variant}&exp=${exp}&sig=${sig}`
}
