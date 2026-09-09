import type { BankCsvMapping, BankCsvPresetDto } from '@avroleva/contracts'
import { bankCsvMapping } from '@avroleva/contracts'
import { parseCsv } from '../../registry/index.js'
import { extractReference } from './reference.js'

/**
 * Bank-statement CSV parsing (pure, ADR 0001 section 4). Bulgarian banks export CSV in a few
 * shapes: `;`-separated with decimal commas and separate debit / credit columns, `,`-separated
 * English headers with a signed amount, tab-separated with an account block above the header.
 * A mapping (column indexes + formats) turns any of them into rows; `guessMapping` proposes one
 * from the header words; presets cover the three shapes the fixtures exercise. Only money coming
 * in (positive amounts) is imported.
 */
export interface BankRowParsed {
  position: number
  /** YYYY-MM-DD */
  bookedAt: string
  amountCents: number
  counterparty: string
  description: string
  reference: string | null
}

export interface ParseResult {
  rows: BankRowParsed[]
  errors: string[]
  header: string[]
  mapping: BankCsvMapping
}

export const BANK_PRESETS: BankCsvPresetDto[] = [
  {
    key: 'bg_semicolon_debit_credit',
    name: 'Извлечение с колони Дебит / Кредит (;)',
    mapping: bankCsvMapping.parse({
      delimiter: ';',
      hasHeader: true,
      dateColumn: 0,
      debitColumn: 2,
      creditColumn: 3,
      counterpartyColumn: 5,
      descriptionColumn: 6,
      referenceColumn: 7,
      dateFormat: 'DD.MM.YYYY',
      decimalSeparator: ',',
    }),
  },
  {
    key: 'en_comma_signed',
    name: 'Export with English headers, signed amount (,)',
    mapping: bankCsvMapping.parse({
      delimiter: ',',
      hasHeader: true,
      dateColumn: 0,
      amountColumn: 1,
      counterpartyColumn: 3,
      descriptionColumn: 4,
      referenceColumn: 5,
      dateFormat: 'DD/MM/YYYY',
      decimalSeparator: '.',
    }),
  },
  {
    key: 'bg_tab_account_block',
    name: 'Извлечение с блок за сметката отгоре (табулация)',
    mapping: bankCsvMapping.parse({
      delimiter: '\t',
      hasHeader: true,
      skipRows: 3,
      dateColumn: 0,
      amountColumn: 1,
      counterpartyColumn: 2,
      descriptionColumn: 3,
      dateFormat: 'DD.MM.YYYY',
      decimalSeparator: ',',
    }),
  },
]

const WORDS = {
  date: ['дата', 'date', 'вальор', 'value date', 'booking'],
  amount: ['сума', 'amount', 'стойност'],
  credit: ['кредит', 'credit', 'приход', 'постъпление'],
  debit: ['дебит', 'debit', 'разход'],
  counterparty: ['наредител', 'контрагент', 'counterparty', 'платец', 'получател', 'name', 'име'],
  description: ['основание', 'описание', 'details', 'description', 'reason', 'narrative', 'текст'],
  reference: ['референция', 'reference', 'ref', 'документ'],
}

function find(header: string[], words: string[], skip: number[] = []): number | null {
  const h = header.map((c) => c.trim().toLowerCase())
  for (const w of words) {
    const i = h.findIndex((c, idx) => !skip.includes(idx) && c.includes(w))
    if (i >= 0) return i
  }
  return null
}

/** Proposes a mapping from the header words; null when no date or description column is found. */
export function guessMapping(
  header: string[],
  delimiter: BankCsvMapping['delimiter'],
  skipRows = 0,
): BankCsvMapping | null {
  const dateColumn = find(header, WORDS.date)
  const descriptionColumn = find(header, WORDS.description)
  if (dateColumn == null || descriptionColumn == null) return null
  const creditColumn = find(header, WORDS.credit)
  const debitColumn = find(header, WORDS.debit)
  const amountColumn = creditColumn == null ? find(header, WORDS.amount) : null
  if (creditColumn == null && amountColumn == null) return null
  const counterpartyColumn = find(header, WORDS.counterparty, [descriptionColumn])
  const referenceColumn = find(header, WORDS.reference, [descriptionColumn, dateColumn])
  const sample = header.join(' ').toLowerCase()
  const english = /amount|date|details|description/.test(sample) && !/[а-я]/.test(sample)
  return bankCsvMapping.parse({
    delimiter,
    hasHeader: true,
    skipRows,
    dateColumn,
    amountColumn,
    creditColumn,
    debitColumn,
    counterpartyColumn,
    descriptionColumn,
    referenceColumn,
    dateFormat: english ? 'DD/MM/YYYY' : 'DD.MM.YYYY',
    decimalSeparator: english ? '.' : ',',
  })
}

/** "1 234,56" / "1.234,56" / "1,234.56" / "-45.00" / "45,00 EUR" -> cents; null when unreadable. */
export function parseAmount(raw: string, decimalSeparator: ',' | '.'): number | null {
  let s = raw.trim().replace(/[A-Za-zА-Яа-я€$£\s\u00a0]/g, '')
  if (!s) return null
  const negative = /^\(.*\)$/.test(s) || s.startsWith('-')
  s = s.replace(/[()]/g, '').replace(/^[-+]/, '')
  if (decimalSeparator === ',') s = s.replace(/\./g, '').replace(',', '.')
  else s = s.replace(/,/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null
  const [units, frac = ''] = s.split('.') as [string, string?]
  const cents = Number(units) * 100 + Number((frac ?? '').padEnd(2, '0'))
  return negative ? -cents : cents
}

export function parseDate(raw: string, format: BankCsvMapping['dateFormat']): string | null {
  const s = raw.trim().slice(0, 10)
  let y: string, m: string, d: string
  if (format === 'YYYY-MM-DD') {
    const mm = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
    if (!mm) return null
    ;[, y, m, d] = mm as unknown as [string, string, string, string]
  } else {
    const sep = format === 'DD.MM.YYYY' ? '.' : format === 'DD/MM/YYYY' ? '/' : '-'
    const parts = s.split(sep)
    if (parts.length !== 3) return null
    ;[d, m, y] = parts as [string, string, string]
    if (y.length === 2) y = `20${y}`
  }
  if (!/^\d{4}$/.test(y) || !/^\d{1,2}$/.test(m) || !/^\d{1,2}$/.test(d)) return null
  const mo = Number(m)
  const da = Number(d)
  if (mo < 1 || mo > 12 || da < 1 || da > 31) return null
  return `${y}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`
}

const cell = (row: string[], idx: number | null | undefined) =>
  idx == null ? '' : (row[idx] ?? '').trim()

/**
 * Parses the CSV text with a mapping. Rows with an unreadable date or amount are reported, not
 * imported; debits (money out) are skipped silently. The reference is taken from the reference
 * column when present, else extracted from the description / counterparty text.
 */
export function parseBankCsv(text: string, mapping: BankCsvMapping): ParseResult {
  // skipRows counts raw lines (an account block may contain blank lines the CSV parser drops).
  const raw = text.replace(/\r\n?/g, '\n').split('\n').slice(mapping.skipRows).join('\n')
  const body = parseCsv(raw, mapping.delimiter)
  const header = mapping.hasHeader ? (body[0] ?? []) : []
  const data = mapping.hasHeader ? body.slice(1) : body
  const rows: BankRowParsed[] = []
  const errors: string[] = []
  data.forEach((r, i) => {
    const line = i + 1 + mapping.skipRows + (mapping.hasHeader ? 1 : 0)
    const bookedAt = parseDate(cell(r, mapping.dateColumn), mapping.dateFormat)
    if (!bookedAt) {
      errors.push(`${line}: date`)
      return
    }
    let amountCents: number | null
    if (mapping.creditColumn != null) {
      const credit = parseAmount(cell(r, mapping.creditColumn), mapping.decimalSeparator)
      const debit =
        mapping.debitColumn != null
          ? parseAmount(cell(r, mapping.debitColumn), mapping.decimalSeparator)
          : null
      if (credit == null && debit == null) {
        errors.push(`${line}: amount`)
        return
      }
      amountCents = credit && credit > 0 ? credit : debit && debit > 0 ? -debit : (credit ?? 0)
    } else {
      amountCents = parseAmount(cell(r, mapping.amountColumn), mapping.decimalSeparator)
      if (amountCents == null) {
        errors.push(`${line}: amount`)
        return
      }
    }
    if (amountCents <= 0) return
    const description = cell(r, mapping.descriptionColumn)
    const counterparty = cell(r, mapping.counterpartyColumn)
    const refCell = cell(r, mapping.referenceColumn)
    const reference =
      extractReference(refCell) ?? extractReference(description) ?? extractReference(counterparty)
    rows.push({
      position: rows.length + 1,
      bookedAt,
      amountCents,
      counterparty,
      description: [description, refCell && !description.includes(refCell) ? refCell : '']
        .filter(Boolean)
        .join(' · '),
      reference,
    })
  })
  return { rows, errors, header, mapping }
}

/** Header row of the file for the mapping editor (after skipRows). */
export function headerOf(text: string, delimiter?: BankCsvMapping['delimiter'], skipRows = 0) {
  const raw = text.replace(/\r\n?/g, '\n').split('\n').slice(skipRows).join('\n')
  return parseCsv(raw, delimiter)[0] ?? []
}

/** Detects the delimiter from the first data-looking line (skipping an account block). */
export function detectMapping(text: string): BankCsvMapping | null {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  for (let skip = 0; skip < Math.min(lines.length, 12); skip++) {
    const line = lines[skip] ?? ''
    for (const d of [';', '\t', ','] as const) {
      const cells = parseCsv(line, d)[0] ?? []
      if (cells.length < 3) continue
      const m = guessMapping(cells, d, skip)
      if (m) return m
    }
  }
  return null
}
