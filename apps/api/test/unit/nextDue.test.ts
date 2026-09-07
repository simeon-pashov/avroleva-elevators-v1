import { describe, expect, it } from 'vitest'
import {
  addMonths,
  daysBetween,
  dueState,
  endOfMonth,
  nextDue,
} from '../../src/modules/maintenance/index.js'
import { addDays, dateOnlyInSofia, monthBounds } from '../../src/platform/clock.js'

const rolling = (lastCheckAt: string | null, intervalDays = 30, overrideAt: string | null = null) =>
  nextDue({ lastCheckAt, intervalDays, overrideAt, strategy: 'rolling' })
const calendar = (
  lastCheckAt: string | null,
  intervalDays = 30,
  overrideAt: string | null = null,
) => nextDue({ lastCheckAt, intervalDays, overrideAt, strategy: 'calendar_month' })

describe('maintenance.nextDue - rolling', () => {
  it('adds the interval in whole days', () => {
    expect(rolling('2026-08-09', 30)).toBe('2026-09-08')
    expect(rolling('2026-08-21', 15)).toBe('2026-09-05')
    expect(rolling('2026-08-29', 10)).toBe('2026-09-08')
  })
  it('crosses month and year ends', () => {
    expect(rolling('2026-01-31', 30)).toBe('2026-03-02')
    expect(rolling('2026-12-15', 30)).toBe('2027-01-14')
    expect(rolling('2028-01-31', 30)).toBe('2028-03-01') // leap year
  })
  it('is not affected by the DST changes in Europe/Sofia (date-only arithmetic)', () => {
    // 2026-03-29 02:00 -> 03:00 (23-hour day) and 2026-10-25 04:00 -> 03:00 (25-hour day)
    expect(rolling('2026-03-28', 1)).toBe('2026-03-29')
    expect(rolling('2026-03-01', 30)).toBe('2026-03-31')
    expect(rolling('2026-03-15', 30)).toBe('2026-04-14')
    expect(rolling('2026-10-24', 1)).toBe('2026-10-25')
    expect(rolling('2026-10-25', 30)).toBe('2026-11-24')
    expect(rolling('2026-09-26', 30)).toBe('2026-10-26')
  })
  it('never checked -> null; override wins over everything', () => {
    expect(rolling(null)).toBeNull()
    expect(rolling(null, 30, '2026-09-09')).toBe('2026-09-09')
    expect(rolling('2026-08-09', 30, '2026-09-09')).toBe('2026-09-09')
    expect(calendar('2026-08-09', 30, '2026-09-09')).toBe('2026-09-09')
  })
  it('guards against a broken interval', () => {
    expect(rolling('2026-08-09', 0)).toBe('2026-08-10')
    expect(rolling('2026-08-09', 15.9)).toBe('2026-08-24')
  })
})

describe('maintenance.nextDue - calendar_month', () => {
  it('next check is due by the end of the following month', () => {
    expect(calendar('2026-08-09', 30)).toBe('2026-09-30')
    expect(calendar('2026-08-31', 30)).toBe('2026-09-30')
    expect(calendar('2026-01-31', 30)).toBe('2026-02-28')
    expect(calendar('2028-01-15', 30)).toBe('2028-02-29')
    expect(calendar('2026-12-03', 30)).toBe('2027-01-31')
  })
  it('longer intervals move whole months (floor(interval / 30), min 1)', () => {
    expect(calendar('2026-08-09', 45)).toBe('2026-09-30')
    expect(calendar('2026-08-09', 60)).toBe('2026-10-31')
    expect(calendar('2026-11-20', 90)).toBe('2027-02-28')
  })
  it('short intervals fall back to rolling', () => {
    expect(calendar('2026-08-29', 10)).toBe('2026-09-08')
    expect(calendar('2026-08-21', 15)).toBe('2026-09-05')
    expect(calendar('2026-08-21', 28)).toBe('2026-09-30')
  })
})

describe('maintenance date helpers', () => {
  it('addMonths clamps to the month length', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2026-03-31', 1)).toBe('2026-04-30')
    expect(addMonths('2026-11-30', 3)).toBe('2027-02-28')
    expect(addMonths('2026-05-15', -2)).toBe('2026-03-15')
  })
  it('endOfMonth / monthBounds / daysBetween', () => {
    expect(endOfMonth('2026-02-10')).toBe('2026-02-28')
    expect(endOfMonth('2028-02-10')).toBe('2028-02-29')
    expect(monthBounds('2026-09')).toEqual({ start: '2026-09-01', end: '2026-09-30' })
    expect(daysBetween('2026-09-08', '2026-09-10')).toBe(2)
    expect(daysBetween('2026-09-08', '2026-09-05')).toBe(-3)
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2) // across DST start
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26')
  })
  it('dateOnlyInSofia uses the Sofia wall clock, not UTC', () => {
    expect(dateOnlyInSofia('2026-09-07T21:30:00Z')).toBe('2026-09-08') // 00:30 EEST
    expect(dateOnlyInSofia('2026-09-08T20:59:00Z')).toBe('2026-09-08') // 23:59 EEST
    expect(dateOnlyInSofia('2026-12-31T22:30:00Z')).toBe('2027-01-01') // 00:30 EET
  })
})

describe('maintenance.dueState', () => {
  const today = '2026-09-08'
  it('classifies by distance to today', () => {
    expect(dueState('2026-09-07', 'active', today)).toBe('overdue')
    expect(dueState('2026-08-01', 'active', today)).toBe('overdue')
    expect(dueState('2026-09-08', 'active', today)).toBe('today')
    expect(dueState('2026-09-09', 'active', today)).toBe('soon')
    expect(dueState('2026-09-15', 'active', today)).toBe('soon')
    expect(dueState('2026-09-16', 'active', today)).toBe('ok')
  })
  it('status overrides the date', () => {
    expect(dueState('2026-09-01', 'stopped_by_firm', today)).toBe('stopped')
    expect(dueState('2026-09-01', 'stopped_by_authority', today)).toBe('stopped')
    expect(dueState('2026-09-01', 'out_of_contract', today)).toBe('none')
    expect(dueState('2026-09-01', 'scrapped', today)).toBe('none')
    expect(dueState(null, 'active', today)).toBe('none')
  })
})
