import { normalizeApiBase } from '../platform/http'

/** Custom scheme of the Android app (AndroidManifest intent filter). */
export const ENROLL_SCHEME = 'avroleva-elevators'

export interface EnrollLink {
  code: string
  /** Server (origin, or origin + BASE_PATH) the link points at; undefined when unknown. */
  server?: string
}

/**
 * Understands every form the enrollment reaches the phone in:
 * - the office QR / e-mail link `https://<host>/<base>/tech/?enroll=<code>` (server = everything
 *   before `/tech/`),
 * - the custom scheme `avroleva-elevators://enroll?server=<origin>&token=<code>`,
 * - a bare code typed or pasted by hand.
 * Returns null for an empty input.
 */
export function parseEnrollLink(raw: string): EnrollLink | null {
  const s = raw.trim()
  if (!s) return null
  if (s.toLowerCase().startsWith(`${ENROLL_SCHEME}:`)) {
    // `avroleva-elevators://enroll?...` - URL parses custom schemes, but not every WebView keeps
    // the host, so read the query by hand.
    const q = s.includes('?') ? s.slice(s.indexOf('?') + 1) : ''
    const params = new URLSearchParams(q)
    const code = (params.get('token') ?? params.get('enroll') ?? '').trim()
    if (!code) return null
    const server = params.get('server')
    return server ? { code, server: normalizeApiBase(server) } : { code }
  }
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s)
      const code = (u.searchParams.get('enroll') ?? '').trim()
      if (!code) return null
      // `/avroleva/elevators-v1/tech/` -> `/avroleva/elevators-v1`; `/tech/` -> ``.
      const path = u.pathname.replace(/\/tech\/?.*$/i, '').replace(/\/$/, '')
      return { code, server: `${u.origin}${path}` }
    } catch {
      return null
    }
  }
  return { code: s }
}

/** Builds the custom-scheme link (used in docs / tests; the office QR keeps the https form). */
export function enrollDeepLink(server: string, code: string): string {
  const q = new URLSearchParams({ server: normalizeApiBase(server), token: code })
  return `${ENROLL_SCHEME}://enroll?${q.toString()}`
}
