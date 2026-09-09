/**
 * Calendar day (YYYY-MM-DD) on the office wall clock in Sofia - the same rule as the API's
 * `todayInSofia`, so "today's plan" means the same thing on the phone and in the office.
 */
export function todayInSofia(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Sofia' }).format(now)
}

export function addDays(dateOnly: string, days: number): string {
  const d = new Date(`${dateOnly}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
