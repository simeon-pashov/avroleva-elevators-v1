import { describe, expect, it } from 'vitest'
import {
  AT_RISK_RATIO,
  canTransition,
  elapsedMinutes,
  responseMinutes,
  slaState,
} from '../../src/modules/callbacks/index.js'
import { canChangeStatus, followUpDueAt } from '../../src/modules/defects/index.js'
import {
  addMonthsDateOnly,
  nextInspectionDue,
  rulesFor,
  severityOf,
} from '../../src/modules/calendar/index.js'
import { newPublicToken } from '../../src/platform/ids.js'
import { defectCatalog, calendarRules } from '@avroleva/domain-data'
import { tenantFeatures, tenantSettings } from '@avroleva/contracts'

const at = (iso: string) => new Date(iso)

describe('callback SLA state', () => {
  const base = {
    receivedAt: at('2026-09-08T10:00:00Z'),
    onSiteAt: null,
    closedAt: null,
    slaMinutes: 60,
  }

  it('is ok while well within the limit and at_risk from 75 %', () => {
    expect(slaState(base, at('2026-09-08T10:30:00Z'))).toBe('ok')
    expect(slaState(base, at('2026-09-08T10:44:59Z'))).toBe('ok')
    expect(slaState(base, at('2026-09-08T10:45:00Z'))).toBe('at_risk')
    expect(AT_RISK_RATIO).toBe(0.75)
  })

  it('is breached after the limit while still running', () => {
    expect(slaState(base, at('2026-09-08T11:00:00Z'))).toBe('at_risk')
    expect(slaState(base, at('2026-09-08T11:01:00Z'))).toBe('breached')
    expect(elapsedMinutes(base, at('2026-09-08T11:01:30Z'))).toBe(61)
  })

  it('freezes on onSiteAt: ok or breached, never at_risk, whatever "now" is', () => {
    const onTime = { ...base, onSiteAt: at('2026-09-08T10:50:00Z') }
    expect(responseMinutes(onTime)).toBe(50)
    expect(slaState(onTime, at('2026-09-09T00:00:00Z'))).toBe('ok')
    const late = { ...base, onSiteAt: at('2026-09-08T11:20:00Z') }
    expect(responseMinutes(late)).toBe(80)
    expect(slaState(late, at('2026-09-08T11:20:00Z'))).toBe('breached')
  })

  it('closed without a visit measures to closedAt', () => {
    const phone = { ...base, closedAt: at('2026-09-08T10:20:00Z') }
    expect(responseMinutes(phone)).toBeNull()
    expect(elapsedMinutes(phone, at('2026-09-10T00:00:00Z'))).toBe(20)
    expect(slaState(phone, at('2026-09-10T00:00:00Z'))).toBe('ok')
  })

  it('transitions', () => {
    expect(canTransition('open', 'dispatched')).toBe(true)
    expect(canTransition('open', 'on_site')).toBe(true)
    expect(canTransition('open', 'released')).toBe(false)
    expect(canTransition('dispatched', 'dispatched')).toBe(true)
    expect(canTransition('on_site', 'released')).toBe(true)
    expect(canTransition('released', 'on_site')).toBe(false)
    expect(canTransition('restored', 'closed')).toBe(true)
    expect(canTransition('closed', 'closed')).toBe(false)
  })
})

describe('defect follow-up', () => {
  it('follow-up date = the Sofia calendar day of recording + N days', () => {
    // 23:30 UTC on 7 Sep = 02:30 on 8 Sep in Sofia (UTC+3)
    expect(followUpDueAt(at('2026-09-07T23:30:00Z'), 30)).toBe('2026-10-08')
    expect(followUpDueAt(at('2026-01-31T10:00:00Z'), 30)).toBe('2026-03-02')
    expect(followUpDueAt(at('2026-09-08T10:00:00Z'), 1)).toBe('2026-09-09')
  })

  it('status can move between the open states but resolved is terminal', () => {
    expect(canChangeStatus('open', 'notified')).toBe(true)
    expect(canChangeStatus('scheduled', 'awaiting_approval')).toBe(true)
    expect(canChangeStatus('awaiting_approval', 'resolved')).toBe(true)
    expect(canChangeStatus('resolved', 'open')).toBe(false)
  })

  it('catalogue: 17 numbered stop-lift items plus a free-text "other"', () => {
    const numbered = defectCatalog.items.filter((i) => i.code !== 'other')
    expect(numbered).toHaveLength(17)
    expect(numbered.every((i) => i.stopLift)).toBe(true)
    expect(numbered.map((i) => i.code)).toEqual(Array.from({ length: 17 }, (_, i) => String(i + 1)))
    expect(defectCatalog.items.find((i) => i.code === 'other')?.stopLift).toBe(false)
    expect(numbered.every((i) => i.bg.length > 5 && i.en.length > 5)).toBe(true)
  })
})

describe('inspection next due', () => {
  const rules = rulesFor(null)

  it('shipped rules: 12 months, first 24, alerts 90/60/30/7', () => {
    expect(rules).toEqual({
      periodicIntervalMonths: 12,
      firstIntervalMonths: 24,
      alertDaysBefore: [90, 60, 30, 7],
      alarmTestIntervalMonths: null,
    })
    expect(calendarRules.defectFollowUpDays).toBe(30)
  })

  it('tenant settings override the shipped defaults', () => {
    const r = rulesFor(
      tenantSettings.parse({ inspectionIntervalMonths: 6, alarmTestIntervalMonths: 3 }),
    )
    expect(r.periodicIntervalMonths).toBe(6)
    expect(r.firstIntervalMonths).toBe(24)
    expect(r.alarmTestIntervalMonths).toBe(3)
  })

  it('performedAt + 12 months, first inspection + 24; failed / pending have no next date', () => {
    expect(nextInspectionDue('2026-03-15', 'passed', rules)).toBe('2027-03-15')
    expect(nextInspectionDue('2026-03-15', 'passed_with_defects', rules)).toBe('2027-03-15')
    expect(nextInspectionDue('2026-03-15', 'passed', rules, true)).toBe('2028-03-15')
    expect(nextInspectionDue('2026-03-15', 'failed', rules)).toBeNull()
    expect(nextInspectionDue('2026-03-15', 'pending', rules)).toBeNull()
    expect(nextInspectionDue(null, 'passed', rules)).toBeNull()
  })

  it('month arithmetic clamps to the last day of the target month', () => {
    expect(addMonthsDateOnly('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonthsDateOnly('2028-01-31', 1)).toBe('2028-02-29')
    expect(addMonthsDateOnly('2026-08-31', 12)).toBe('2027-08-31')
    expect(addMonthsDateOnly('2026-03-31', -1)).toBe('2026-02-28')
  })

  it('severity: overdue < today, due within the nearest alert offset, upcoming beyond', () => {
    expect(severityOf('2026-09-07', '2026-09-08', rules)).toBe('overdue')
    expect(severityOf('2026-09-08', '2026-09-08', rules)).toBe('due')
    expect(severityOf('2026-09-15', '2026-09-08', rules)).toBe('due')
    expect(severityOf('2026-09-16', '2026-09-08', rules)).toBe('upcoming')
  })
})

describe('public token', () => {
  it('has 128 bits of entropy and is URL-safe', () => {
    const tokens = new Set<string>()
    for (let i = 0; i < 1000; i++) {
      const tkn = newPublicToken()
      expect(tkn).toMatch(/^[0-9a-f]{32}$/)
      tokens.add(tkn)
    }
    expect(tokens.size).toBe(1000)
    // Every hex position takes every nibble value at least once across 1000 samples.
    const seen = Array.from({ length: 32 }, () => new Set<string>())
    for (const tkn of tokens) for (let i = 0; i < 32; i++) seen[i]!.add(tkn[i]!)
    expect(seen.every((s) => s.size === 16)).toBe(true)
  })

  it('feature flags default off', () => {
    expect(tenantFeatures.parse({})).toEqual({ publicQrPage: false, publicFaultReport: false })
  })
})
