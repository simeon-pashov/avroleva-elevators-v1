import type { CallbackStatus, SlaState } from '@avroleva/contracts'

/** At 75 % of the limit an open callback is "at risk" (MVP-PLAN phase 4). */
export const AT_RISK_RATIO = 0.75

export interface SlaInput {
  receivedAt: Date
  onSiteAt: Date | null
  closedAt: Date | null
  slaMinutes: number
}

/** receivedAt -> onSiteAt in whole minutes (floor); null until the technician is on site. */
export function responseMinutes(c: Pick<SlaInput, 'receivedAt' | 'onSiteAt'>): number | null {
  if (!c.onSiteAt) return null
  return Math.max(0, Math.floor((c.onSiteAt.getTime() - c.receivedAt.getTime()) / 60_000))
}

/**
 * Minutes on the timer: to onSiteAt when known, else to closedAt (closed without a visit),
 * else to `now` (still running).
 */
export function elapsedMinutes(c: SlaInput, now: Date): number {
  const end = c.onSiteAt ?? c.closedAt ?? now
  return Math.max(0, Math.floor((end.getTime() - c.receivedAt.getTime()) / 60_000))
}

/**
 * ok | at_risk | breached. A record with a known end (on site, or closed without a visit) is
 * either ok or breached - "at risk" only exists while the timer is still running.
 */
export function slaState(c: SlaInput, now: Date): SlaState {
  const elapsed = elapsedMinutes(c, now)
  if (elapsed > c.slaMinutes) return 'breached'
  const running = !c.onSiteAt && !c.closedAt
  if (running && elapsed >= c.slaMinutes * AT_RISK_RATIO) return 'at_risk'
  return 'ok'
}

export type TransitionType = 'dispatched' | 'on_site' | 'released' | 'restored' | 'closed'

const ALLOWED: Record<CallbackStatus, readonly TransitionType[]> = {
  open: ['dispatched', 'on_site', 'closed'],
  dispatched: ['dispatched', 'on_site', 'closed'],
  on_site: ['released', 'restored', 'closed'],
  released: ['restored', 'closed'],
  restored: ['closed'],
  closed: [],
}

export function canTransition(from: CallbackStatus, to: TransitionType): boolean {
  return ALLOWED[from].includes(to)
}

export const OPEN_STATUSES: readonly CallbackStatus[] = [
  'open',
  'dispatched',
  'on_site',
  'released',
  'restored',
]
