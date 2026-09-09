import type { BillingCycle, ContractBilling } from '@avroleva/contracts'
import { monthBounds } from '../../../platform/clock.js'

/**
 * Billing cycle math (pure, ADR 0001). A contract is billed monthly unless its `billing`
 * override says quarterly / yearly (period = 3 / 12 months starting at the contract's start
 * month) or `exempt`. The scheduled run is due from `runDay` of the month (clamped to the month
 * length) and generates the current month's period; a missed day catches up on the next tick.
 */
export interface Cycle {
  cycle: BillingCycle
  anchorDay: number | null
  exempt: boolean
}

export function cycleOf(contract: { billing?: ContractBilling | null }): Cycle {
  const b = contract.billing
  return {
    cycle: b?.cycle ?? 'monthly',
    anchorDay: b?.anchorDay ?? null,
    exempt: b?.exempt ?? false,
  }
}

export function periodMonths(cycle: BillingCycle): 1 | 3 | 12 {
  return cycle === 'yearly' ? 12 : cycle === 'quarterly' ? 3 : 1
}

/** YYYY-MM + n months. */
export function addMonths(period: string, n: number): string {
  const [y, m] = period.split('-').map(Number) as [number, number]
  const d = new Date(Date.UTC(y, m - 1 + n, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** Whole months from period a to period b (b - a). */
export function monthsBetween(a: string, b: string): number {
  const [ay, am] = a.split('-').map(Number) as [number, number]
  const [by, bm] = b.split('-').map(Number) as [number, number]
  return (by - ay) * 12 + (bm - am)
}

/**
 * True when `period` opens a billing period of this contract: monthly always; quarterly / yearly
 * when the months since the contract's start month divide by the cycle length.
 */
export function periodStartsCycle(
  contractStartDate: string,
  period: string,
  cycle: BillingCycle,
): boolean {
  const months = periodMonths(cycle)
  if (months === 1) return true
  const diff = monthsBetween(contractStartDate.slice(0, 7), period)
  return diff >= 0 && diff % months === 0
}

/** Last day (YYYY-MM-DD) of a period of `months` months starting at YYYY-MM `period`. */
export function periodEnd(period: string, months: number): string {
  return monthBounds(addMonths(period, months - 1)).end
}

export function daysInMonth(period: string): number {
  const [y, m] = period.split('-').map(Number) as [number, number]
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** The run day clamped to the month (runDay 31 in February = 28/29). */
export function clampRunDay(runDay: number, period: string): number {
  return Math.min(Math.max(1, runDay), daysInMonth(period))
}

/**
 * The scheduled run's target: the current month's period and whether the run is due today
 * (day of month ≥ run day). Catch-up idempotent: running twice in a month generates nothing new.
 */
export function runTargetFor(today: string, runDay: number): { period: string; due: boolean } {
  const period = today.slice(0, 7)
  const day = Number(today.slice(8, 10))
  return { period, due: day >= clampRunDay(runDay, period) }
}

/** The run day of one contract: its anchorDay, else the tenant run day. */
export function effectiveRunDay(cycle: Cycle, tenantRunDay: number): number {
  return cycle.anchorDay ?? tenantRunDay
}
