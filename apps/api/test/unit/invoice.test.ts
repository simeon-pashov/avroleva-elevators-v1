import { describe, expect, it } from 'vitest'
import { invoiceForPeriod } from '../../src/modules/billing/index.js'

const settings = { invoiceDueDays: 14, vatRatePercent: 20 }
const contract = {
  startDate: '2025-03-01',
  endDate: null,
  paymentDay: 10,
  lines: [
    {
      id: 'l1',
      elevatorId: 'e1',
      elevatorInternalNo: 'вх. А, ляв',
      monthlyPriceCents: 5500,
      fromDate: '2025-03-01',
      toDate: null,
    },
    {
      id: 'l2',
      elevatorId: 'e2',
      elevatorInternalNo: 'вх. А, десен',
      monthlyPriceCents: 4500,
      fromDate: '2025-03-01',
      toDate: '2026-08-15',
    },
    {
      id: 'l3',
      elevatorId: 'e3',
      elevatorInternalNo: 'нов',
      monthlyPriceCents: 6000,
      fromDate: '2026-10-01',
      toDate: null,
    },
  ],
}

describe('billing.invoiceForPeriod (pure)', () => {
  it('bills the lines in force during the month, VAT rounded once, due on the contract paymentDay', () => {
    const d = invoiceForPeriod(contract, '2026-09', settings)!
    expect(d.periodStart).toBe('2026-09-01')
    expect(d.periodEnd).toBe('2026-09-30')
    expect(d.lines.map((l) => l.elevatorId)).toEqual(['e1'])
    expect(d.amountCents).toBe(5500)
    expect(d.vatCents).toBe(1100)
    expect(d.totalCents).toBe(6600)
    expect(d.issuedAt).toBe('2026-09-01')
    expect(d.dueAt).toBe('2026-09-10')
  })
  it('a line that ends mid-month is still billed for that month; a future line is not', () => {
    const aug = invoiceForPeriod(contract, '2026-08', settings)!
    expect(aug.lines.map((l) => l.elevatorId)).toEqual(['e1', 'e2'])
    expect(aug.amountCents).toBe(10000)
    const oct = invoiceForPeriod(contract, '2026-10', settings)!
    expect(oct.lines.map((l) => l.elevatorId)).toEqual(['e1', 'e3'])
    expect(oct.lines[1]!.description).toContain('нов')
  })
  it('falls back to issue date + invoiceDueDays without a paymentDay; 0 % VAT when not registered', () => {
    const d = invoiceForPeriod({ ...contract, paymentDay: null }, '2026-09', {
      invoiceDueDays: 10,
      vatRatePercent: 0,
    })!
    expect(d.dueAt).toBe('2026-09-11')
    expect(d.vatCents).toBe(0)
    expect(d.totalCents).toBe(5500)
  })
  it('rounds VAT half-up on odd amounts', () => {
    const d = invoiceForPeriod(
      { ...contract, lines: [{ ...contract.lines[0]!, monthlyPriceCents: 3333 }] },
      '2026-09',
      settings,
    )!
    expect(d.vatCents).toBe(667)
    expect(d.totalCents).toBe(4000)
  })
  it('returns null before the contract starts, after it ends, or when nothing is billable', () => {
    expect(invoiceForPeriod(contract, '2025-02', settings)).toBeNull()
    expect(invoiceForPeriod({ ...contract, endDate: '2026-06-30' }, '2026-07', settings)).toBeNull()
    expect(
      invoiceForPeriod({ ...contract, endDate: '2026-06-30' }, '2026-06', settings),
    ).not.toBeNull()
    expect(
      invoiceForPeriod(
        { ...contract, lines: [{ ...contract.lines[0]!, monthlyPriceCents: 0 }] },
        '2026-09',
        settings,
      ),
    ).toBeNull()
  })
  it('clamps a paymentDay beyond the 28th', () => {
    const d = invoiceForPeriod({ ...contract, paymentDay: 31 }, '2026-02', settings)!
    expect(d.dueAt).toBe('2026-02-28')
  })
})
