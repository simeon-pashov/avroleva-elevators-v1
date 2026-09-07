/** Clock port (ARCHITECTURE A1). Tests may replace `clock.now`. */
export const clock = {
  now: (): Date => new Date(),
}

/** Date-only helpers in Europe/Sofia, returned as YYYY-MM-DD. */
export function todayInSofia(now: Date = clock.now()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Sofia' }).format(now)
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
