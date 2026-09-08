/**
 * CSV (RFC 4180, comma, CRLF) with a UTF-8 BOM so Excel opens Cyrillic correctly. Pure.
 * Values: Date -> ISO (date-only columns are passed as YYYY-MM-DD by the caller), boolean ->
 * true/false, objects -> JSON, null/undefined -> empty.
 */
export const CSV_BOM = String.fromCharCode(0xfeff)

export type CsvValue = string | number | boolean | Date | null | undefined | object

export function csvCell(v: CsvValue): string {
  let s: string
  if (v === null || v === undefined) return ''
  else if (v instanceof Date) s = v.toISOString()
  else if (typeof v === 'object') s = JSON.stringify(v)
  else s = String(v)
  // A leading =, +, -, @ would be executed as a formula by Excel (CSV injection); neutralise it.
  if (/^[=+\-@]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function csvLine(values: CsvValue[]): string {
  return values.map(csvCell).join(',') + '\r\n'
}

/** Date column (Prisma @db.Date arrives as UTC midnight) -> YYYY-MM-DD. */
export function dateOnly(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : ''
}
