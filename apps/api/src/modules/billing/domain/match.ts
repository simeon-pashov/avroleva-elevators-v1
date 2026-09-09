import { extractReference } from './reference.js'

/**
 * Reconciliation (pure, ADR 0001 section 4): a bank row matches an open invoice by the payer
 * reference first, then by the exact open amount plus the customer's name in the counterparty,
 * and otherwise waits for a person. Several rows may hit the same invoice (partial payments).
 */
export interface OpenInvoiceLike {
  id: string
  number: number
  paymentReference: string
  openCents: number
  customerName: string
  buildingId: string
}

export interface RowLike {
  reference: string | null
  description: string
  counterparty: string
  amountCents: number
}

export interface MatchResult {
  matchKind: 'reference' | 'amount_name' | 'none'
  invoiceId: string | null
}

// \b is ASCII-only in JS regexes: Cyrillic legal forms need Unicode-aware lookarounds.
const LEGAL_FORMS = new RegExp(
  '(?<![\\p{L}\\p{N}])(?:еоод|оод|еад|ад|ет|ес|сд|кд|ltd|llc|gmbh|jsc|етажна собственост|сдружение на собствениците)(?![\\p{L}\\p{N}])',
  'gu',
)

/** Lower-case, no quotes / punctuation / legal-form suffixes, single spaces. */
export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[„“”"'«»]/g, ' ')
    .replace(LEGAL_FORMS, ' ')
    .replace(/[.,;:()/\\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** True when every significant word of the customer name appears in the counterparty text. */
export function nameMatches(customerName: string, counterparty: string): boolean {
  const target = normalizeName(counterparty)
  if (!target) return false
  const words = normalizeName(customerName)
    .split(' ')
    .filter((w) => w.length >= 2)
  if (words.length === 0) return false
  return words.every((w) => target.includes(w))
}

export function matchRow(
  row: RowLike,
  invoices: OpenInvoiceLike[],
  claimed: ReadonlySet<string> = new Set(),
): MatchResult {
  const ref =
    (row.reference && extractReference(row.reference)) ??
    extractReference(row.description) ??
    extractReference(row.counterparty)
  if (ref) {
    const hit = invoices.find((i) => i.paymentReference.toUpperCase() === ref)
    if (hit) return { matchKind: 'reference', invoiceId: hit.id }
  }
  const text = `${row.counterparty} ${row.description}`
  const candidates = invoices.filter(
    (i) =>
      !claimed.has(i.id) && i.openCents === row.amountCents && nameMatches(i.customerName, text),
  )
  if (candidates.length === 1) return { matchKind: 'amount_name', invoiceId: candidates[0]!.id }
  return { matchKind: 'none', invoiceId: null }
}

/**
 * One statement at a time: rows matched by reference claim their invoice first, so a second row
 * of the same customer and amount is not left ambiguous by an invoice that is already spoken for.
 */
export function matchRows<R extends RowLike>(
  rows: R[],
  invoices: OpenInvoiceLike[],
): Array<R & MatchResult> {
  const claimed = new Set<string>()
  const first = rows.map((r) => {
    const m = matchRow(r, invoices)
    if (m.matchKind === 'reference' && m.invoiceId) claimed.add(m.invoiceId)
    return m
  })
  return rows.map((r, i) => {
    const m = first[i]!
    if (m.matchKind === 'reference') return { ...r, ...m }
    const second = matchRow(r, invoices, claimed)
    if (second.invoiceId) claimed.add(second.invoiceId)
    return { ...r, ...second }
  })
}
