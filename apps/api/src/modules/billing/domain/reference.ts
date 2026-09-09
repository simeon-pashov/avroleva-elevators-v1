/**
 * Payer reference (ADR 0001): `AE-<last 4 digits of the firm's EIK>-<6-digit invoice number>`,
 * printed on every invoice and statement and expected back on the bank transfer. Short enough to
 * type on a phone banking app, unique per tenant, and recognisable in a free-text description.
 */
export const REFERENCE_PREFIX = 'AE'

export function paymentReferenceFor(eik: string, number: number): string {
  const digits = eik.replace(/\D/g, '')
  const short = (digits.slice(-4) || '0000').padStart(4, '0')
  return `${REFERENCE_PREFIX}-${short}-${String(number).padStart(6, '0')}`
}

/** Tolerant: "AE-1234-000042", "ae 1234 42", "AE_1234_000042", Cyrillic "АЕ" typed by mistake. */
const REFERENCE_RE = /(?:AE|АЕ)\s*[-–_/ ]?\s*(\d{4})\s*[-–_/ ]?\s*(\d{1,8})(?!\d)/i

export function extractReference(text: string | null | undefined): string | null {
  if (!text) return null
  const m = REFERENCE_RE.exec(text)
  if (!m) return null
  return `${REFERENCE_PREFIX}-${m[1]}-${m[2]!.padStart(6, '0')}`
}

export function normalizeReference(ref: string): string {
  return extractReference(ref) ?? ref.trim().toUpperCase()
}
