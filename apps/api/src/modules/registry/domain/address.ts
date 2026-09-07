import type { Address } from '@avroleva/contracts'

/** Canonical single-line address for documents and search (ARCHITECTURE section 3, building.addressText). */
export function buildAddressText(a: Address): string {
  const parts: string[] = []
  if (a.city) parts.push(a.postcode ? `${a.postcode} ${a.city}` : a.city)
  if (a.district) parts.push(a.district)
  const streetLine = [a.street, a.number].filter(Boolean).join(' ')
  if (streetLine) parts.push(streetLine)
  if (a.block) parts.push(`бл. ${a.block}`)
  if (a.entrance) parts.push(`вх. ${a.entrance}`)
  return parts.join(', ')
}

/** Key used to detect duplicate buildings on import: city + district + street/number + block + entrance. */
export function addressKey(a: Address): string {
  return [a.city, a.district, a.street, a.number, a.block, a.entrance]
    .map((s) => (s ?? '').toString().trim().toLowerCase().replace(/\s+/g, ' '))
    .join('|')
}

const LOOKALIKES: Record<string, string> = {
  а: 'a',
  в: 'b',
  е: 'e',
  к: 'k',
  м: 'm',
  н: 'h',
  о: 'o',
  р: 'p',
  с: 'c',
  т: 't',
  у: 'y',
  х: 'x',
}

/** Strips spaces/dashes and unifies Cyrillic/Latin lookalikes so "СФ 1234" and "CФ-1234" match. */
export function normalizeRegNo(regNo: string | null | undefined): string | null {
  if (!regNo) return null
  const s = regNo
    .toLowerCase()
    .replace(/[\s\-./]/g, '')
    .split('')
    .map((ch) => LOOKALIKES[ch] ?? ch)
    .join('')
  return s || null
}

/** Phones normalised to +359 where the input is clearly Bulgarian (MVP-PLAN section 3). */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  let s = raw.replace(/[\s().-]/g, '')
  if (!s) return null
  if (s.startsWith('00')) s = '+' + s.slice(2)
  if (/^0[1-9]\d{7,8}$/.test(s)) s = '+359' + s.slice(1)
  if (/^359\d{8,9}$/.test(s)) s = '+' + s
  return s
}
