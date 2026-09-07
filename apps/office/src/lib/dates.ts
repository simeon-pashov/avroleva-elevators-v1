/** Calendar helpers. Business days are Europe/Sofia (ARCHITECTURE: timezone), inputs are local. */

const SOFIA = 'Europe/Sofia'

/** YYYY-MM-DD in Sofia. */
export function todaySofia(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: SOFIA }).format(new Date())
}

/** YYYY-MM in Sofia. */
export function currentMonthSofia(): string {
  return todaySofia().slice(0, 7)
}

/** Date-only arithmetic on YYYY-MM-DD strings (no DST surprises: computed in UTC). */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function tomorrowSofia(): string {
  return addDays(todaySofia(), 1)
}

/** Whole days from `today` to `isoDate` (negative when in the past). */
export function daysUntil(isoDate: string, today = todaySofia()): number {
  return Math.round((Date.parse(isoDate) - Date.parse(today)) / 86_400_000)
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Current local time as the value of an `<input type="datetime-local">` (minute precision). */
export function nowLocalInput(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** `<input type="datetime-local">` value -> ISO 8601 with the browser's UTC offset (e.g. +03:00). */
export function localInputToIso(value: string): string {
  const d = new Date(value)
  const withSeconds = value.length === 16 ? `${value}:00` : value
  const offsetMin = -d.getTimezoneOffset()
  const sign = offsetMin >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMin)
  return `${withSeconds}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}
