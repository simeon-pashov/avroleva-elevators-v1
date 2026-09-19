import type { Problem } from '@avroleva/contracts'
import { APP_VERSION } from '../version'
import { compareSemver } from '../lib/semver'
import { API_BASE_KEY, SESSION_TOKEN_KEY, secureStorage } from './secureStorage'

/** RFC 7807 answer of the API. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly problem: Problem,
  ) {
    super(problem.title || `HTTP ${status}`)
    this.name = 'ApiError'
  }
}

/** fetch() threw (offline, DNS, CORS, timeout): retryable. */
export class NetworkError extends Error {
  constructor(message = 'network') {
    super(message)
    this.name = 'NetworkError'
  }
}

export interface HttpResponse<T> {
  status: number
  data: T
  headers: Headers
}

export interface RequestOptions {
  body?: unknown
  form?: FormData
  headers?: Record<string, string>
  /** Attach the Bearer token (default true). */
  auth?: boolean
  timeoutMs?: number
}

export interface HttpClient {
  request<T>(method: string, path: string, opts?: RequestOptions): Promise<HttpResponse<T>>
  /** Absolute or root-relative URL of an API path (`/sync/pull` -> `<base>/api/v1/sync/pull`). */
  apiUrl(path: string): string
  /** Resolves a signed relative URL from a DTO (`/files/..`) or a page (`/print/..`). */
  resolveUrl(relative: string): string
}

export const UPDATE_REQUIRED_EVENT = 'avroleva:update-required'
export const UNAUTHORIZED_EVENT = 'avroleva:unauthorized'

let apiBaseOverride = ''
let acceptLanguage = 'bg'

/** Runtime override from Settings/Enroll (persisted in secureStorage). Empty = the build-time default. */
export function setApiBaseOverride(base: string): void {
  apiBaseOverride = normalizeApiBase(base)
}
export function getApiBaseOverride(): string {
  return apiBaseOverride
}
export function setHttpLocale(locale: string): void {
  acceptLanguage = locale
}

/** Trims, drops a trailing slash and a trailing `/tech/` (people paste the app URL). */
export function normalizeApiBase(raw: string): string {
  let s = raw.trim().replace(/\/+$/, '')
  s = s.replace(/\/tech$/i, '').replace(/\/+$/, '')
  return s
}

/** Applies and persists the server address chosen on the Enroll screen / in Settings. */
export function persistApiBase(base: string): void {
  const s = normalizeApiBase(base)
  apiBaseOverride = s
  if (s && s !== defaultApiBase()) secureStorage.set(API_BASE_KEY, s)
  else secureStorage.remove(API_BASE_KEY)
}

/** Restores the persisted server address (after `platformReady`). */
export function loadApiBase(): string {
  apiBaseOverride = normalizeApiBase(secureStorage.get(API_BASE_KEY) ?? '')
  return apiBaseOverride
}

/**
 * Build-time default. `VITE_DEFAULT_API_ORIGIN` (the native build: origin, or origin + BASE_PATH,
 * e.g. `https://srv1662742.hstgr.cloud/avroleva/elevators-v1`) wins; `VITE_API_BASE` is the older
 * name and still honoured. Empty = same origin: the API lives next to the app, one level above
 * `/tech/` (`/tech/` -> ``, `/avroleva/elevators-v1/tech/` -> `/avroleva/elevators-v1`). In dev
 * the Vite proxy forwards `/api`.
 */
export function defaultApiBase(): string {
  const env = (
    import.meta.env.VITE_DEFAULT_API_ORIGIN ||
    import.meta.env.VITE_API_BASE ||
    ''
  ).trim()
  if (env) return env.replace(/\/$/, '')
  const base = import.meta.env.BASE_URL || '/'
  return base.replace(/\/tech\/?$/, '').replace(/\/$/, '')
}

export function effectiveApiBase(): string {
  return apiBaseOverride || defaultApiBase()
}

function readToken(): string | null {
  return secureStorage.get(SESSION_TOKEN_KEY)
}

async function parseBody(res: Response): Promise<unknown> {
  if (res.status === 204) return undefined
  const text = await res.text()
  const ct = res.headers.get('content-type') ?? ''
  if (ct.includes('json') && text) {
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }
  return text
}

export const webHttp: HttpClient = {
  apiUrl(path) {
    return `${effectiveApiBase()}/api/v1${path}`
  },
  resolveUrl(relative) {
    if (/^https?:\/\//i.test(relative)) return relative
    const base = effectiveApiBase()
    // Server-minted links (signed file URLs) already carry BASE_PATH: do not prefix it twice.
    const basePath = base.replace(/^https?:\/\/[^/]+/i, '')
    if (basePath && relative.startsWith(`${basePath}/`))
      return `${base.slice(0, -basePath.length)}${relative}`
    return `${base}${relative.startsWith('/') ? '' : '/'}${relative}`
  },
  async request<T>(method: string, path: string, opts: RequestOptions = {}) {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Accept-Language': acceptLanguage,
      'X-Client': 'app',
      'X-Client-Version': APP_VERSION,
      ...opts.headers,
    }
    if (opts.auth !== false) {
      const token = readToken()
      if (token) headers.Authorization = `Bearer ${token}`
    }
    let body: BodyInit | undefined
    if (opts.form) body = opts.form
    else if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(opts.body)
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000)
    let res: Response
    try {
      res = await fetch(this.apiUrl(path), {
        method,
        headers,
        body,
        credentials: 'omit',
        signal: controller.signal,
      })
    } catch (err) {
      throw new NetworkError(err instanceof Error ? err.message : 'network')
    } finally {
      clearTimeout(timer)
    }
    const min = res.headers.get('x-min-client-version')
    if (min && compareSemver(min, APP_VERSION) > 0) {
      window.dispatchEvent(new CustomEvent(UPDATE_REQUIRED_EVENT, { detail: { min } }))
    }
    const data = await parseBody(res)
    if (!res.ok) {
      const problem: Problem =
        data && typeof data === 'object' && 'status' in (data as object)
          ? (data as Problem)
          : {
              type: 'about:blank',
              title: res.statusText || `HTTP ${res.status}`,
              status: res.status,
              code: res.status >= 500 ? 'error.internal' : 'error.validation',
            }
      if (res.status === 401 && opts.auth !== false)
        window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT))
      throw new ApiError(res.status, problem)
    }
    return { status: res.status, data: data as T, headers: res.headers }
  },
}
