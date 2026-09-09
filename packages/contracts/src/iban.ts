/**
 * IBAN helpers (pure, shared by the API's settings validation and the office form). Checksum per
 * ISO 13616 (mod 97-10); country lengths for the countries a Bulgarian firm is likely to bank in.
 */
const IBAN_LENGTHS: Record<string, number> = {
  BG: 22,
  AT: 20,
  BE: 16,
  CH: 21,
  CY: 28,
  CZ: 24,
  DE: 22,
  DK: 18,
  EE: 20,
  ES: 24,
  FI: 18,
  FR: 27,
  GB: 22,
  GR: 27,
  HR: 21,
  HU: 28,
  IE: 22,
  IT: 27,
  LT: 20,
  LU: 20,
  LV: 21,
  MT: 31,
  NL: 18,
  NO: 15,
  PL: 28,
  PT: 25,
  RO: 24,
  SE: 24,
  SI: 19,
  SK: 24,
  TR: 26,
}

/** Upper-case, no spaces or separators. */
export function normalizeIban(raw: string): string {
  return raw.replace(/[\s-]/g, '').toUpperCase()
}

/** Groups of four for display and documents ("BG80 BNBG 9661 1020 3456 78"). */
export function formatIban(raw: string): string {
  return normalizeIban(raw).replace(/(.{4})(?=.)/g, '$1 ')
}

/** mod 97-10 over the rearranged string; letters A..Z become 10..35. Big-int free. */
export function ibanChecksumOk(iban: string): boolean {
  const s = normalizeIban(iban)
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(s)) return false
  const rearranged = s.slice(4) + s.slice(0, 4)
  let remainder = 0
  for (const ch of rearranged) {
    const v = ch >= 'A' && ch <= 'Z' ? String(ch.charCodeAt(0) - 55) : ch
    for (const d of v) remainder = (remainder * 10 + Number(d)) % 97
  }
  return remainder === 1
}

/** True for a syntactically valid IBAN with a correct checksum and (when known) country length. */
export function isValidIban(raw: string): boolean {
  const s = normalizeIban(raw)
  if (!ibanChecksumOk(s)) return false
  const expected = IBAN_LENGTHS[s.slice(0, 2)]
  return expected === undefined || s.length === expected
}

/** BIC / SWIFT: 8 or 11 characters, bank(4) country(2) location(2) [branch(3)]. */
export function isValidBic(raw: string): boolean {
  return /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(raw.replace(/\s/g, '').toUpperCase())
}
