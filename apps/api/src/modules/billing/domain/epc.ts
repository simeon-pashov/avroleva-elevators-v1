import QRCode from 'qrcode'
import { normalizeIban } from '@avroleva/contracts'

/**
 * EPC069-12 "SEPA credit transfer" QR (the "GiroCode" every EU banking app scans): a plain-text
 * payload of LF-separated elements. Version 002 (BIC optional), character set 1 = UTF-8,
 * identification SCT, amount as `EUR<units>.<cents>`, the payer reference in the unstructured
 * remittance element. Error-correction level M as the standard recommends; payload ≤ 331 bytes.
 */
export interface EpcInput {
  beneficiary: string
  iban: string
  bic?: string | null
  amountCents: number
  /** Unstructured remittance information (the payment reference), ≤ 140 chars. */
  remittance: string
  /** Optional "information" element shown to the payer, ≤ 70 chars. */
  information?: string | null
}

const cut = (s: string, max: number) => Array.from(s.trim()).slice(0, max).join('')

export function epcAmount(cents: number): string {
  if (cents <= 0) return ''
  const units = Math.floor(cents / 100)
  const rest = cents % 100
  return `EUR${units}.${String(rest).padStart(2, '0')}`
}

export function epcPayload(i: EpcInput): string {
  const lines = [
    'BCD',
    '002',
    '1',
    'SCT',
    (i.bic ?? '').replace(/\s/g, '').toUpperCase(),
    cut(i.beneficiary, 70),
    normalizeIban(i.iban),
    epcAmount(i.amountCents),
    '',
    '',
    cut(i.remittance, 140),
  ]
  if (i.information) lines.push(cut(i.information, 70))
  return lines.join('\n')
}

/** Inverse of epcPayload (tests, and a sanity check before rendering). */
export function parseEpcPayload(payload: string): EpcInput | null {
  const l = payload.split('\n')
  if (l[0] !== 'BCD' || l[3] !== 'SCT' || !l[6]) return null
  const amount = l[7] ?? ''
  const m = /^EUR(\d+)\.(\d{2})$/.exec(amount)
  return {
    beneficiary: l[5] ?? '',
    iban: l[6],
    bic: l[4] || null,
    amountCents: m ? Number(m[1]) * 100 + Number(m[2]) : 0,
    remittance: l[10] ?? '',
    information: l[11] ?? null,
  }
}

export async function epcQrSvg(payload: string): Promise<string> {
  return QRCode.toString(payload, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 })
}
