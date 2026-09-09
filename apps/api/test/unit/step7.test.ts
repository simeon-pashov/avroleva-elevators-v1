import { describe, expect, it } from 'vitest'
import jsQR from 'jsqr'
import sharp from 'sharp'
import QRCode from 'qrcode'
import { isValidBic, isValidIban, formatIban, normalizeIban } from '@avroleva/contracts'
import {
  BANK_PRESETS,
  addMonths,
  clampRunDay,
  cycleOf,
  detectMapping,
  epcAmount,
  epcPayload,
  extractReference,
  foldStatement,
  invoiceForPeriod,
  lateFeeFor,
  matchBankRowPure,
  matchRows,
  nameMatches,
  nextStage,
  normalizeName,
  openCentsOf,
  orderStages,
  parseAmount,
  parseBankCsv,
  parseDate,
  parseEpcPayload,
  paymentReferenceFor,
  periodStartsCycle,
  runTargetFor,
  stageDate,
  statusAfterBalanceChange,
} from '../../src/modules/billing/index.js'
import { billingDefaults } from '@avroleva/domain-data'

const settings = { invoiceDueDays: 14, vatRatePercent: 20 }
const contract = {
  startDate: '2026-02-15',
  endDate: null,
  paymentDay: null,
  billing: null,
  lines: [
    {
      id: 'l1',
      elevatorId: 'e1',
      elevatorInternalNo: 'A',
      monthlyPriceCents: 5000,
      fromDate: '2026-02-15',
      toDate: null,
    },
    {
      id: 'l2',
      elevatorId: 'e2',
      elevatorInternalNo: 'B',
      monthlyPriceCents: 3000,
      fromDate: '2026-04-01',
      toDate: null,
    },
  ],
}

describe('billing cycle math (ADR 0001)', () => {
  it('monthly contracts bill every month; quarterly / yearly only on their cycle start', () => {
    expect(periodStartsCycle('2026-02-15', '2026-05', 'monthly')).toBe(true)
    expect(periodStartsCycle('2026-02-15', '2026-02', 'quarterly')).toBe(true)
    expect(periodStartsCycle('2026-02-15', '2026-03', 'quarterly')).toBe(false)
    expect(periodStartsCycle('2026-02-15', '2026-05', 'quarterly')).toBe(true)
    expect(periodStartsCycle('2026-02-15', '2026-08', 'quarterly')).toBe(true)
    expect(periodStartsCycle('2026-02-15', '2027-02', 'yearly')).toBe(true)
    expect(periodStartsCycle('2026-02-15', '2026-11', 'yearly')).toBe(false)
    expect(periodStartsCycle('2026-02-15', '2026-01', 'quarterly')).toBe(false)
  })
  it('a quarterly invoice covers three months and bills each line for the months it overlaps', () => {
    const d = invoiceForPeriod(contract, '2026-02', settings, 3)!
    expect(d.periodStart).toBe('2026-02-01')
    expect(d.periodEnd).toBe('2026-04-30')
    // A: Feb, Mar, Apr = 3 months; B: only April = 1 month.
    expect(d.lines.map((l) => l.amountCents)).toEqual([15000, 3000])
    expect(d.lines[1]!.description).toContain('(1)')
    expect(d.vatCents).toBe(3600)
    expect(d.totalCents).toBe(21600)
    expect(d.dueAt).toBe('2026-02-15')
  })
  it('the monthly invoice is unchanged (one month, full price, due days from settings)', () => {
    const d = invoiceForPeriod(contract, '2026-05', settings)!
    expect(d.periodEnd).toBe('2026-05-31')
    expect(d.amountCents).toBe(8000)
    expect(d.dueAt).toBe('2026-05-15')
  })
  it('run day: due from the day, clamped to the month length, catch-up idempotent on later days', () => {
    expect(runTargetFor('2026-09-01', 1)).toEqual({ period: '2026-09', due: true })
    expect(runTargetFor('2026-09-04', 5)).toEqual({ period: '2026-09', due: false })
    expect(runTargetFor('2026-09-05', 5)).toEqual({ period: '2026-09', due: true })
    expect(runTargetFor('2026-09-27', 5)).toEqual({ period: '2026-09', due: true })
    expect(clampRunDay(28, '2026-02')).toBe(28)
    expect(clampRunDay(31, '2026-02')).toBe(28)
    expect(runTargetFor('2028-02-29', 28).due).toBe(true)
    expect(addMonths('2026-12', 1)).toBe('2027-01')
    expect(addMonths('2026-01', -1)).toBe('2025-12')
    expect(cycleOf({ billing: null })).toEqual({ cycle: 'monthly', anchorDay: null, exempt: false })
    expect(cycleOf({ billing: { cycle: 'yearly', anchorDay: 10, exempt: false } }).cycle).toBe(
      'yearly',
    )
  })
})

describe('invoice states as data', () => {
  const base = {
    totalCents: 12000,
    lateFeeCents: 0,
    creditedCents: 0,
    paidCents: 0,
    dueAt: '2026-09-15',
  }
  it('open balance = total + late fee - credited - paid, never negative, 0 when closed', () => {
    expect(openCentsOf({ ...base, status: 'issued' })).toBe(12000)
    expect(
      openCentsOf({
        ...base,
        status: 'issued',
        lateFeeCents: 1000,
        creditedCents: 2000,
        paidCents: 5000,
      }),
    ).toBe(6000)
    expect(openCentsOf({ ...base, status: 'paid', paidCents: 12000 })).toBe(0)
    expect(openCentsOf({ ...base, status: 'issued', paidCents: 20000 })).toBe(0)
  })
  it('status after a balance change: partially paid, overdue stays overdue, paid when settled', () => {
    expect(
      statusAfterBalanceChange({ ...base, status: 'issued', paidCents: 5000 }, '2026-09-10'),
    ).toBe('partially_paid')
    expect(
      statusAfterBalanceChange({ ...base, status: 'issued', paidCents: 5000 }, '2026-09-20'),
    ).toBe('overdue')
    expect(
      statusAfterBalanceChange({ ...base, status: 'overdue', paidCents: 5000 }, '2026-09-20'),
    ).toBe('overdue')
    expect(
      statusAfterBalanceChange({ ...base, status: 'overdue', paidCents: 12000 }, '2026-09-20'),
    ).toBe('paid')
    expect(
      statusAfterBalanceChange({ ...base, status: 'issued', creditedCents: 12000 }, '2026-09-10'),
    ).toBe('paid')
    expect(statusAfterBalanceChange({ ...base, status: 'void' }, '2026-09-10')).toBe('void')
  })
})

describe('dunning schedule math', () => {
  const stages = orderStages(billingDefaults.stages.map((s) => ({ ...s, active: true })))
  const inv = {
    id: 'i',
    dueAt: '2026-09-01',
    openCents: 12000,
    totalCents: 12000,
    dunningStage: 0,
    lateFeeCents: 0,
  }
  it('system defaults are +3 / +14 / +30 with positions 1..3', () => {
    expect(stages.map((s) => [s.key, s.offsetDays, s.position])).toEqual([
      ['reminder', 3, 1],
      ['second_reminder', 14, 2],
      ['final_notice', 30, 3],
    ])
    expect(stageDate('2026-09-01', stages[2]!)).toBe('2026-10-01')
  })
  it('nothing before the first offset, one stage at a time, the latest reached after a gap', () => {
    expect(nextStage(stages, inv, '2026-09-03')).toBeNull()
    expect(nextStage(stages, inv, '2026-09-04')?.key).toBe('reminder')
    expect(nextStage(stages, { ...inv, dunningStage: 1 }, '2026-09-10')).toBeNull()
    expect(nextStage(stages, { ...inv, dunningStage: 1 }, '2026-09-15')?.key).toBe(
      'second_reminder',
    )
    // Worker was down for six weeks: jump straight to the final notice, no replay.
    expect(nextStage(stages, inv, '2026-10-20')?.key).toBe('final_notice')
    expect(nextStage(stages, { ...inv, dunningStage: 3 }, '2026-12-01')).toBeNull()
    expect(nextStage(stages, { ...inv, openCents: 0 }, '2026-12-01')).toBeNull()
    const inactive = stages.map((s) => (s.key === 'second_reminder' ? { ...s, active: false } : s))
    expect(nextStage(inactive, { ...inv, dunningStage: 1 }, '2026-09-20')).toBeNull()
  })
  it('late fee: off by default, grace days, flat / percent, cap', () => {
    const rule = billingDefaults.lateFeeRules[0]!
    expect(lateFeeFor(rule, inv, '2026-12-01')).toBe(0) // disabled
    const on = { ...rule, enabled: true }
    expect(lateFeeFor(on, inv, '2026-09-30')).toBe(0) // grace 30 days not over
    expect(lateFeeFor(on, inv, '2026-10-01')).toBe(1000)
    expect(lateFeeFor({ ...on, kind: 'percent', percentBp: 250 }, inv, '2026-10-01')).toBe(300)
    expect(
      lateFeeFor({ ...on, capCents: 1500 }, { ...inv, lateFeeCents: 1000 }, '2026-10-01'),
    ).toBe(500)
    expect(
      lateFeeFor({ ...on, capCents: 1000 }, { ...inv, lateFeeCents: 1000 }, '2026-10-01'),
    ).toBe(0)
    expect(lateFeeFor(null, inv, '2026-10-01')).toBe(0)
  })
})

describe('IBAN / BIC', () => {
  it('validates the checksum and the country length', () => {
    expect(isValidIban('BG80 BNBG 9661 1020 3456 78')).toBe(true)
    expect(isValidIban('bg80bnbg96611020345678')).toBe(true)
    expect(isValidIban('DE89 3704 0044 0532 0130 00')).toBe(true)
    expect(isValidIban('GB82 WEST 1234 5698 7654 32')).toBe(true)
    expect(isValidIban('BG80 BNBG 9661 1020 3456 79')).toBe(false)
    expect(isValidIban('BG80BNBG966110203456')).toBe(false)
    expect(isValidIban('')).toBe(false)
    expect(isValidIban('1234')).toBe(false)
    expect(normalizeIban(' bg80 bnbg-9661 ')).toBe('BG80BNBG9661')
    expect(formatIban('BG80BNBG96611020345678')).toBe('BG80 BNBG 9661 1020 3456 78')
    expect(isValidBic('BNBGBGSD')).toBe(true)
    expect(isValidBic('UNCRBGSFXXX')).toBe(true)
    expect(isValidBic('BNBG')).toBe(false)
  })
})

describe('payer reference', () => {
  it('formats from the EIK and the number and is found in free text', () => {
    expect(paymentReferenceFor('200000001', 42)).toBe('AE-0001-000042')
    expect(paymentReferenceFor('BG123456789', 7)).toBe('AE-6789-000007')
    expect(extractReference('Плащане AE-0001-000042 за септември')).toBe('AE-0001-000042')
    expect(extractReference('ae 0001 42')).toBe('AE-0001-000042')
    expect(extractReference('АЕ_0001_000042')).toBe('AE-0001-000042')
    expect(extractReference('фактура 1042')).toBeNull()
    expect(extractReference(null)).toBeNull()
  })
})

describe('EPC069-12 payload', () => {
  const input = {
    beneficiary: 'Демо Лифт Сервиз ЕООД',
    iban: 'BG80 BNBG 9661 1020 3456 78',
    bic: 'BNBGBGSD',
    amountCents: 12345,
    remittance: 'AE-0001-000042',
  }
  it('has the standard elements in order and round-trips', () => {
    const p = epcPayload(input)
    expect(p.split('\n')).toEqual([
      'BCD',
      '002',
      '1',
      'SCT',
      'BNBGBGSD',
      'Демо Лифт Сервиз ЕООД',
      'BG80BNBG96611020345678',
      'EUR123.45',
      '',
      '',
      'AE-0001-000042',
    ])
    expect(Buffer.byteLength(p, 'utf8')).toBeLessThanOrEqual(331)
    expect(parseEpcPayload(p)).toMatchObject({
      iban: 'BG80BNBG96611020345678',
      amountCents: 12345,
      remittance: 'AE-0001-000042',
      bic: 'BNBGBGSD',
    })
    expect(epcAmount(5)).toBe('EUR0.05')
    expect(epcAmount(0)).toBe('')
    expect(epcPayload({ ...input, bic: null }).split('\n')[4]).toBe('')
    expect(epcPayload({ ...input, beneficiary: 'x'.repeat(100) }).split('\n')[5]).toHaveLength(70)
  })
  it('the rendered QR decodes back to the payload (jsqr over a PNG raster)', async () => {
    const payload = epcPayload(input)
    const png = await QRCode.toBuffer(payload, { errorCorrectionLevel: 'M', scale: 6, margin: 2 })
    const { data, info } = await sharp(png)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    const decoded = jsQR(
      new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
      info.width,
      info.height,
    )
    expect(decoded?.data).toBe(payload)
  })
})

const CSV_SEMICOLON = `Дата;Вальор;Дебит;Кредит;Валута;Наредител/Получател;Основание;Референция
02.09.2026;02.09.2026;;120,00;EUR;ЕС „Младост 1, бл. 25“;асансьор AE-0001-000012;REF001
03.09.2026;03.09.2026;45,50;;EUR;ЧЕЗ Електро;ток машинно;REF002
05.09.2026;05.09.2026;;1 234,56;EUR;„Домоуправител Плюс“ ЕООД;поддръжка септември;
`
const CSV_COMMA = `Date,Amount,Currency,Counterparty,Details,Reference
01/09/2026,66.00,EUR,"Vitosha Properties OOD","maintenance AE-0001-000031",TX1
04/09/2026,-15.00,EUR,"Bank","fee",TX2
06/09/2026,"1,000.00",EUR,"Oborishte municipality","September",TX3
`
const CSV_TAB = `Сметка\tBG80BNBG96611020345678
Период\t01.09.2026 - 30.09.2026

Дата на осчетоводяване\tСума\tКонтрагент\tОписание
07.09.2026\t72,00\tЕС Люлин 5 бл. 512\tAE-0001-000040 плащане
08.09.2026\t-9,90\tТакса\tмесечна такса
09.09.2026\t50,00\tВасил Тодоров\tчастично AE 0001 41
`

describe('bank CSV parser', () => {
  it('parses amounts and dates in the Bulgarian and English shapes', () => {
    expect(parseAmount('1 234,56', ',')).toBe(123456)
    expect(parseAmount('1.234,56', ',')).toBe(123456)
    expect(parseAmount('1,234.56', '.')).toBe(123456)
    expect(parseAmount('-45.00', '.')).toBe(-4500)
    expect(parseAmount('45,00 EUR', ',')).toBe(4500)
    expect(parseAmount('(12,00)', ',')).toBe(-1200)
    expect(parseAmount('abc', ',')).toBeNull()
    expect(parseDate('02.09.2026', 'DD.MM.YYYY')).toBe('2026-09-02')
    expect(parseDate('01/09/2026', 'DD/MM/YYYY')).toBe('2026-09-01')
    expect(parseDate('2026-09-01T00:00', 'YYYY-MM-DD')).toBe('2026-09-01')
    expect(parseDate('31.02.2026', 'DD.MM.YYYY')).toBe('2026-02-31')
    expect(parseDate('x', 'DD.MM.YYYY')).toBeNull()
  })
  it('semicolon export with debit / credit columns (preset 1): credits only, references extracted', () => {
    const r = parseBankCsv(CSV_SEMICOLON, BANK_PRESETS[0]!.mapping)
    expect(r.errors).toEqual([])
    expect(r.rows).toHaveLength(2)
    expect(r.rows[0]).toMatchObject({
      bookedAt: '2026-09-02',
      amountCents: 12000,
      reference: 'AE-0001-000012',
    })
    expect(r.rows[0]!.counterparty).toContain('Младост')
    expect(r.rows[1]).toMatchObject({
      bookedAt: '2026-09-05',
      amountCents: 123456,
      reference: null,
    })
  })
  it('comma export with a signed amount (preset 2)', () => {
    const r = parseBankCsv(CSV_COMMA, BANK_PRESETS[1]!.mapping)
    expect(r.errors).toEqual([])
    expect(r.rows.map((x) => x.amountCents)).toEqual([6600, 100000])
    expect(r.rows[0]!.reference).toBe('AE-0001-000031')
    expect(r.rows[1]!.counterparty).toBe('Oborishte municipality')
  })
  it('tab export with an account block above the header (preset 3) and auto-detection', () => {
    const r = parseBankCsv(CSV_TAB, BANK_PRESETS[2]!.mapping)
    expect(r.errors).toEqual([])
    expect(r.rows.map((x) => [x.amountCents, x.reference])).toEqual([
      [7200, 'AE-0001-000040'],
      [5000, 'AE-0001-000041'],
    ])
    for (const [text, preset] of [
      [CSV_SEMICOLON, 0],
      [CSV_COMMA, 1],
      [CSV_TAB, 2],
    ] as const) {
      const m = detectMapping(text)!
      expect(m).not.toBeNull()
      expect(parseBankCsv(text, m).rows).toHaveLength(2)
      expect(m.delimiter).toBe(BANK_PRESETS[preset]!.mapping.delimiter)
    }
    expect(detectMapping('a,b\n1,2\n')).toBeNull()
  })
})

describe('reconciliation matcher', () => {
  const invoices = [
    {
      id: 'i12',
      number: 12,
      paymentReference: 'AE-0001-000012',
      openCents: 12000,
      customerName: 'ЕС „Младост 1, бл. 25“',
      buildingId: 'b1',
    },
    {
      id: 'i31',
      number: 31,
      paymentReference: 'AE-0001-000031',
      openCents: 6600,
      customerName: '„Витоша Пропъртис“ ООД',
      buildingId: 'b7',
    },
    {
      id: 'i40',
      number: 40,
      paymentReference: 'AE-0001-000040',
      openCents: 7200,
      customerName: 'ЕС „Люлин 5, бл. 512“',
      buildingId: 'b3',
    },
    {
      id: 'i41',
      number: 41,
      paymentReference: 'AE-0001-000041',
      openCents: 10000,
      customerName: 'ЕС „Красно село, бл. 199“',
      buildingId: 'b10',
    },
    {
      id: 'i50',
      number: 50,
      paymentReference: 'AE-0001-000050',
      openCents: 7200,
      customerName: 'ЕС „Люлин 5, бл. 512“',
      buildingId: 'b3',
    },
  ]
  it('reference first, then exact amount + name, else nothing', () => {
    expect(
      matchBankRowPure(
        {
          reference: null,
          description: 'плащане AE-0001-000012',
          counterparty: 'някой',
          amountCents: 999,
        },
        invoices,
      ),
    ).toEqual({ matchKind: 'reference', invoiceId: 'i12' })
    expect(
      matchBankRowPure(
        { reference: 'AE 0001 31', description: '', counterparty: '', amountCents: 1 },
        invoices,
      ),
    ).toEqual({ matchKind: 'reference', invoiceId: 'i31' })
    expect(
      matchBankRowPure(
        {
          reference: null,
          description: 'поддръжка',
          counterparty: 'ВИТОША ПРОПЪРТИС ООД',
          amountCents: 6600,
        },
        invoices,
      ),
    ).toEqual({ matchKind: 'amount_name', invoiceId: 'i31' })
    // Two open invoices of the same customer with the same amount: ambiguous, left to a person.
    expect(
      matchBankRowPure(
        { reference: null, description: '', counterparty: 'ЕС Люлин 5 бл. 512', amountCents: 7200 },
        invoices,
      ),
    ).toEqual({ matchKind: 'none', invoiceId: null })
    // Partial payment without a reference: amount differs, no match.
    expect(
      matchBankRowPure(
        {
          reference: null,
          description: '',
          counterparty: 'Красно село бл. 199',
          amountCents: 5000,
        },
        invoices,
      ),
    ).toEqual({ matchKind: 'none', invoiceId: null })
    // Partial payment with a reference still matches (the service books it as a partial payment).
    expect(
      matchBankRowPure(
        {
          reference: null,
          description: 'частично AE 0001 41',
          counterparty: 'Васил Тодоров',
          amountCents: 5000,
        },
        invoices,
      ),
    ).toEqual({ matchKind: 'reference', invoiceId: 'i41' })
    expect(
      matchRows(
        [{ reference: null, description: 'x', counterparty: 'y', amountCents: 1 }],
        invoices,
      )[0]!.matchKind,
    ).toBe('none')
    // Within one statement a reference row claims its invoice, so the twin is no longer ambiguous.
    const batch = matchRows(
      [
        { reference: 'AE-0001-000040', description: '', counterparty: '', amountCents: 7200 },
        { reference: null, description: '', counterparty: 'ЕС Люлин 5 бл. 512', amountCents: 7200 },
      ],
      invoices,
    )
    expect(batch.map((b) => [b.matchKind, b.invoiceId])).toEqual([
      ['reference', 'i40'],
      ['amount_name', 'i50'],
    ])
  })
  it('name normalisation strips quotes and legal forms', () => {
    expect(normalizeName('„Витоша Пропъртис“ ООД')).toBe('витоша пропъртис')
    expect(normalizeName('ЕС „Младост 1, бл. 25“')).toBe('младост 1 бл 25')
    expect(nameMatches('„Витоша Пропъртис“ ООД', 'VITOSHA')).toBe(false)
    expect(nameMatches('„Витоша Пропъртис“ ООД', 'Превод от Витоша Пропъртис ЕООД')).toBe(true)
    expect(nameMatches('', 'x')).toBe(false)
  })
})

describe('statement fold', () => {
  const labels = {
    invoice: (i: { number: number }) => `inv ${i.number}`,
    payment: (p: { invoiceNumber: number | null }) => `pay ${p.invoiceNumber ?? '-'}`,
    creditNote: (c: { number: number }) => `cn ${c.number}`,
    lateFee: (a: { invoiceNumber: number }) => `fee ${a.invoiceNumber}`,
  }
  it('runs a balance in date order with the opening balance from earlier movements', () => {
    const r = foldStatement(
      {
        invoices: [
          {
            id: 'a',
            number: 1,
            status: 'paid',
            issuedAt: '2026-06-01',
            totalCents: 100,
            paymentReference: 'r1',
            period: '2026-06',
          },
          {
            id: 'b',
            number: 2,
            status: 'overdue',
            issuedAt: '2026-07-01',
            totalCents: 200,
            paymentReference: 'r2',
            period: '2026-07',
          },
          {
            id: 'c',
            number: 3,
            status: 'void',
            issuedAt: '2026-07-02',
            totalCents: 999,
            paymentReference: 'r3',
            period: '2026-07',
          },
          {
            id: 'd',
            number: 4,
            status: 'issued',
            issuedAt: '2026-09-01',
            totalCents: 300,
            paymentReference: 'r4',
            period: '2026-09',
          },
        ],
        payments: [
          {
            id: 'p1',
            paidAt: '2026-06-10',
            amountCents: 100,
            invoiceId: 'a',
            invoiceNumber: 1,
            reference: 'r1',
            method: 'bank',
          },
          {
            id: 'p2',
            paidAt: '2026-07-20',
            amountCents: 50,
            invoiceId: 'b',
            invoiceNumber: 2,
            reference: null,
            method: 'cash',
          },
          {
            id: 'p3',
            paidAt: '2026-08-05',
            amountCents: 20,
            invoiceId: null,
            invoiceNumber: null,
            reference: null,
            method: 'cash',
          },
        ],
        creditNotes: [
          {
            id: 'cn',
            number: 1,
            issuedAt: '2026-07-25',
            totalCents: 30,
            invoiceId: 'b',
            invoiceNumber: 2,
          },
        ],
        adjustments: [
          {
            id: 'f',
            date: '2026-08-15',
            amountCents: 10,
            invoiceId: 'b',
            invoiceNumber: 2,
            stageKey: 'final_notice',
          },
        ],
      },
      '2026-07-01',
      '2026-08-31',
      labels,
    )
    expect(r.openingBalanceCents).toBe(0)
    expect(r.lines.map((l) => [l.kind, l.balanceCents])).toEqual([
      ['invoice', 200],
      ['payment', 150],
      ['credit_note', 120],
      ['payment', 100],
      ['late_fee', 110],
    ])
    expect(r.closingBalanceCents).toBe(110)
    const later = foldStatement(
      {
        invoices: [],
        payments: [
          {
            id: 'x',
            paidAt: '2026-09-01',
            amountCents: 5,
            invoiceId: null,
            invoiceNumber: null,
            reference: null,
            method: 'cash',
          },
        ],
        creditNotes: [],
        adjustments: [],
      },
      '2026-09-01',
      '2026-09-30',
      labels,
    )
    expect(later.lines[0]!.balanceCents).toBe(-5)
    const windowed = foldStatement(
      {
        invoices: [
          {
            id: 'a',
            number: 1,
            status: 'issued',
            issuedAt: '2026-06-01',
            totalCents: 100,
            paymentReference: 'r1',
            period: '2026-06',
          },
        ],
        payments: [],
        creditNotes: [],
        adjustments: [],
      },
      '2026-07-01',
      '2026-07-31',
      labels,
    )
    expect(windowed.openingBalanceCents).toBe(100)
    expect(windowed.lines).toEqual([])
    expect(windowed.closingBalanceCents).toBe(100)
  })
})
