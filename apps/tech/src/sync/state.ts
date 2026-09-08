import { getMeta } from '../db'
import { ApiError, NetworkError } from '../platform'

export type SyncEventType =
  | 'pull:start'
  | 'pull:done'
  | 'pull:error'
  | 'push:start'
  | 'push:done'
  | 'push:error'
  | 'unauthorized'

const target = new EventTarget()

export function emitSync(type: SyncEventType, detail?: unknown): void {
  target.dispatchEvent(new CustomEvent(type, { detail }))
}

export function onSync(type: SyncEventType, handler: (detail: unknown) => void): () => void {
  const h = (e: Event) => handler((e as CustomEvent).detail)
  target.addEventListener(type, h)
  return () => target.removeEventListener(type, h)
}

// ---- device clock (ARCHITECTURE A13) ---------------------------------------------------------

let clockOffsetMs = 0

export function getClockOffsetMs(): number {
  return clockOffsetMs
}
export function setClockOffsetMs(v: number): void {
  clockOffsetMs = v
}
export async function loadClockOffset(): Promise<void> {
  clockOffsetMs = (await getMeta('clockOffsetMs')) ?? 0
}

export function nowIso(): string {
  return new Date().toISOString()
}

/** Every timestamp the app produces: device clock + the last measured offset. */
export function deviceTime(): { at: string; clientOffsetMs: number; timestampSource: 'device' } {
  return { at: nowIso(), clientOffsetMs: clockOffsetMs, timestampSource: 'device' }
}

export const CLOCK_SUSPECT_MS = 2 * 60_000

// ---- error text ------------------------------------------------------------------------------

export function errorText(err: unknown): string {
  if (err instanceof ApiError) return err.problem.title || err.problem.code || `HTTP ${err.status}`
  if (err instanceof NetworkError) return 'network'
  if (err instanceof Error) return err.message
  return String(err)
}
