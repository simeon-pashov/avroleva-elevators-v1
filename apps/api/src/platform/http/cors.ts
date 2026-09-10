import type { RequestHandler } from 'express'
import { MIN_CLIENT_VERSION_HEADER } from '@avroleva/contracts'

/**
 * CORS for the native technician app only (ARCHITECTURE section 4 "Capacitor later"). The office
 * SPA and the PWA are same-origin and never need it. Inside the Capacitor WebView the page origin
 * is `https://localhost` (androidScheme https) - older shells used `capacitor://localhost` /
 * `http://localhost` - and every call carries `Authorization: Bearer` (cookies are unreliable
 * there), so the allow-list is exact, credentials are allowed and a foreign origin gets no CORS
 * headers at all (the browser then blocks the response). Preflights answer 204 without touching
 * auth or the rate limiter.
 */
export const APP_ORIGINS: ReadonlySet<string> = new Set([
  'capacitor://localhost',
  'https://localhost',
  'http://localhost',
  'ionic://localhost',
])

const ALLOW_HEADERS = [
  'Authorization',
  'Content-Type',
  'Accept',
  'Accept-Language',
  'X-Client',
  'X-Client-Version',
  'X-Requested-With',
  'Idempotency-Key',
].join(', ')

const EXPOSE_HEADERS = [MIN_CLIENT_VERSION_HEADER, 'X-Request-Id', 'Content-Disposition'].join(', ')

export function isAppOrigin(origin: string | undefined): boolean {
  return !!origin && APP_ORIGINS.has(origin.toLowerCase())
}

export const appCors: RequestHandler = (req, res, next) => {
  const origin = req.header('origin')
  // Vary on every path so caches never hand a CORS answer to a same-origin caller or vice versa.
  res.vary('Origin')
  if (!isAppOrigin(origin)) return next()
  res.setHeader('Access-Control-Allow-Origin', origin!)
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Access-Control-Expose-Headers', EXPOSE_HEADERS)
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
    res.setHeader(
      'Access-Control-Allow-Headers',
      req.header('access-control-request-headers') || ALLOW_HEADERS,
    )
    res.setHeader('Access-Control-Max-Age', '86400')
    res.status(204).end()
    return
  }
  next()
}
