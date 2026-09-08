/** Clock port (ARCHITECTURE A1). Tests may replace `clock.now`. */
export const clock = {
  now: (): Date => new Date(),
}

/** Date-only helpers in Europe/Sofia, returned as YYYY-MM-DD. */
export function todayInSofia(now: Date = clock.now()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Sofia' }).format(now)
}

/** Calendar day (YYYY-MM-DD) of an instant as seen on the office wall clock in Sofia. */
export function dateOnlyInSofia(at: Date | string): string {
  return todayInSofia(typeof at === 'string' ? new Date(at) : at)
}

/** First and last day (YYYY-MM-DD) of a YYYY-MM period. */
export function monthBounds(yearMonth: string): { start: string; end: string } {
  const [y, m] = yearMonth.split('-').map(Number) as [number, number]
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { start: `${yearMonth}-01`, end: `${yearMonth}-${String(last).padStart(2, '0')}` }
}

export function addDays(dateOnly: string, days: number): string {
  const d = new Date(dateOnly + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function toDateOnly(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null
}

export function fromDateOnly(s: string | null | undefined): Date | null {
  return s ? new Date(s + 'T00:00:00Z') : null
}

export const CLOCK_SUSPECT_OFFSET_MS = 2 * 60 * 1000
export const CLOCK_SUSPECT_AHEAD_MS = 5 * 60 * 1000

/**
 * Clock provenance rule (ARCHITECTURE section 4, A13): an event from a device is `clockSuspect`
 * when the phone's measured offset to the server is > 2 min, or its timestamp is > 5 min ahead of
 * the server clock at receipt. Nothing is rewritten - the flag is for the office to review.
 */
export function clockSuspect(at: Date, receivedAt: Date, clientOffsetMs?: number | null): boolean {
  if (clientOffsetMs != null && Math.abs(clientOffsetMs) > CLOCK_SUSPECT_OFFSET_MS) return true
  return at.getTime() > receivedAt.getTime() + CLOCK_SUSPECT_AHEAD_MS
}
