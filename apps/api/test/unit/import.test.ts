import { describe, expect, it } from 'vitest'
import { IMPORT_COLUMNS } from '@avroleva/contracts'
import { detectDelimiter, parseCsv, toCsv } from '../../src/modules/registry/domain/csv.js'
import {
  parseBgDate,
  parseImport,
  templateExampleRows,
} from '../../src/modules/registry/domain/import.js'
import {
  buildAddressText,
  normalizePhone,
  normalizeRegNo,
} from '../../src/modules/registry/domain/address.js'
import { effectiveIntervalDays, nextCheckDue } from '../../src/modules/registry/domain/due.js'

describe('csv', () => {
  it('parses quotes, escaped quotes, BOM and CRLF; detects delimiter', () => {
    const rows = parseCsv('﻿a;b;c\r\n"x;1";"he said ""hi""";3\r\n')
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['x;1', 'he said "hi"', '3'],
    ])
    expect(detectDelimiter('a,b,c')).toBe(',')
    expect(detectDelimiter('a\tb')).toBe('\t')
  })
  it('round-trips through toCsv', () => {
    const csv = toCsv(
      [
        ['Град', 'Улица и №'],
        ['София', 'ул. "Оборище" 35'],
      ],
      ';',
    )
    expect(csv.startsWith('﻿')).toBe(true)
    expect(parseCsv(csv)).toEqual([
      ['Град', 'Улица и №'],
      ['София', 'ул. "Оборище" 35'],
    ])
  })
})

describe('import parsing', () => {
  const header = IMPORT_COLUMNS.join(';')
  const csv = (...rows: string[][]) => [header, ...rows.map((r) => r.join(';'))].join('\n')

  it('parses the template example row', () => {
    const r = parseImport(csv(templateExampleRows[0]!))
    expect(r.issues.filter((i) => i.level === 'error')).toEqual([])
    expect(r.rows).toHaveLength(1)
    const row = r.rows[0]!
    expect(row.customerKind).toBe('etazhna_sobstvenost')
    expect(row.address.city).toBe('София')
    expect(row.address.block).toBe('25')
    expect(row.stops).toBe(9)
    expect(row.monthlyPriceCents).toBe(5500)
    expect(row.contractStart).toBe('2025-01-01')
    expect(row.lastCheckAt).toBe('2026-08-15')
    expect(row.contactPhone).toBe('+359888123456')
    expect(row.contactViber).toBe(true)
    expect(row.lat).toBe(42.6501)
    expect(row.regNo).toBe('СФ-1234')
  })

  it('reports per-row errors with row and column, and duplicates', () => {
    const bad = [...templateExampleRows[0]!]
    bad[6] = '' // Град
    bad[19] = '99' // Спирки
    bad[22] = '31.02.2025' // Договор от
    const dup = [...templateExampleRows[0]!]
    const r = parseImport(csv(templateExampleRows[0]!, bad, dup))
    const errors = r.issues.filter((i) => i.level === 'error')
    expect(errors.map((e) => [e.row, e.column, e.code])).toEqual(
      expect.arrayContaining([
        [2, 'Град', 'import.required'],
        [2, 'Спирки', 'import.stopsRange'],
        [2, 'Договор от', 'import.invalidDate'],
        [3, 'Асансьор №', 'import.duplicateElevator'],
      ]),
    )
    expect(r.issues.some((i) => i.code === 'import.duplicateRegNo' && i.level === 'warning')).toBe(
      true,
    )
  })

  it('fails on a missing mandatory column and an empty file', () => {
    expect(
      parseImport('Ползвател;Телефон\nx;y').issues.some((i) => i.code === 'import.missingColumn'),
    ).toBe(true)
    expect(parseImport('').issues[0]?.code).toBe('import.emptyFile')
  })

  it('accepts header aliases and comma delimiter', () => {
    const r = parseImport('Град,Улица,Асансьор,Спирки\nПловдив,ул. Иван Вазов 5,ляв,6')
    expect(r.issues.filter((i) => i.level === 'error')).toEqual([])
    expect(r.rows[0]?.address.street).toBe('ул. Иван Вазов')
    expect(r.rows[0]?.address.number).toBe('5')
    expect(r.rows[0]?.stops).toBe(6)
  })

  it('parses Bulgarian dates', () => {
    expect(parseBgDate('5.3.2026')).toBe('2026-03-05')
    expect(parseBgDate('2026-03-05')).toBe('2026-03-05')
    expect(parseBgDate('31.02.2026')).toBe('invalid')
    expect(parseBgDate('')).toBeNull()
  })
})

describe('address helpers', () => {
  it('builds the canonical address line', () => {
    expect(
      buildAddressText({
        city: 'София',
        postcode: '1784',
        district: 'ж.к. Младост 1',
        block: '25',
        entrance: 'А',
      }),
    ).toBe('1784 София, ж.к. Младост 1, бл. 25, вх. А')
    expect(buildAddressText({ city: 'София', street: 'ул. Оборище', number: '35' })).toBe(
      'София, ул. Оборище 35',
    )
  })
  it('normalises registration numbers and phones', () => {
    expect(normalizeRegNo('СФ 12-34')).toBe(normalizeRegNo('cф1234'))
    expect(normalizePhone('0888 123 456')).toBe('+359888123456')
    expect(normalizePhone('+359 2 950 12 34')).toBe('+35929501234')
    expect(normalizePhone('')).toBeNull()
  })
})

describe('due computation (registry hint)', () => {
  it('uses the elevator interval, else the tenant default', () => {
    expect(effectiveIntervalDays({ checkIntervalDays: null }, { checkIntervalDays: 30 })).toBe(30)
    expect(effectiveIntervalDays({ checkIntervalDays: 15 }, { checkIntervalDays: 30 })).toBe(15)
    expect(nextCheckDue('2026-08-15', 30)).toBe('2026-09-14')
    expect(nextCheckDue(null, 30)).toBeNull()
  })
})
