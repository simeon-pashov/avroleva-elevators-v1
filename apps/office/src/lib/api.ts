import type { Problem } from '@avroleva/contracts'

/** Base path baked at build time (VITE_BASE); API calls are same-origin and relative to it. */
export const BASE = (import.meta.env.BASE_URL || '/').replace(/\/$/, '')
export const apiUrl = (path: string) => `${BASE}/api/v1${path}`

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly problem: Problem,
  ) {
    super(problem.title || `HTTP ${status}`)
    this.name = 'ApiError'
  }
  /** Field messages keyed by path (already translated by the server in the user's locale). */
  get fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const f of this.problem.fields ?? []) if (!(f.path in out)) out[f.path] = f.message
    return out
  }
}

export const UNAUTHORIZED_EVENT = 'avroleva:unauthorized'

interface Options {
  /** Suppress the global unauthorized event (e.g. the login page itself, or the initial /me probe). */
  silent401?: boolean
  acceptLanguage?: string
}

export async function api<T>(
  method: string,
  path: string,
  body?: unknown,
  opts: Options = {},
): Promise<T> {
  const headers: Record<string, string> = {
    'X-Requested-With': 'avroleva',
    Accept: 'application/json',
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (opts.acceptLanguage) headers['Accept-Language'] = opts.acceptLanguage
  const res = await fetch(apiUrl(path), {
    method,
    headers,
    credentials: 'same-origin',
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (res.status === 204) return undefined as T
  const text = await res.text()
  const isJson = (res.headers.get('content-type') ?? '').includes('json')
  const data = isJson && text ? JSON.parse(text) : text
  if (!res.ok) {
    const problem: Problem =
      isJson && data && typeof data === 'object'
        ? (data as Problem)
        : { type: 'about:blank', title: res.statusText, status: res.status, code: 'error.internal' }
    if (res.status === 401 && !opts.silent401)
      window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT))
    throw new ApiError(res.status, problem)
  }
  return data as T
}

export const get = <T>(path: string, opts?: Options) => api<T>('GET', path, undefined, opts)
export const post = <T>(path: string, body?: unknown, opts?: Options) =>
  api<T>('POST', path, body ?? {}, opts)
export const patch = <T>(path: string, body: unknown, opts?: Options) =>
  api<T>('PATCH', path, body, opts)
export const put = <T>(path: string, body: unknown, opts?: Options) =>
  api<T>('PUT', path, body, opts)
export const del = <T = void>(path: string, opts?: Options) =>
  api<T>('DELETE', path, undefined, opts)

export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params))
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v))
  const s = p.toString()
  return s ? `?${s}` : ''
}
