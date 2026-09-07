import { useEffect, useState } from 'react'
import type { CallbackDto, SlaState } from '@avroleva/contracts'

/** Re-renders every `ms` (default 30 s) so timers tick without refetching. */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const h = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(h)
  }, [ms])
  return now
}

const AT_RISK_RATIO = 0.75

/** Same rule as the API (callbacks/domain/sla.ts), evaluated on the office clock for the timer. */
export function liveSla(
  c: Pick<CallbackDto, 'receivedAt' | 'onSiteAt' | 'closedAt' | 'slaMinutes'>,
  now: number,
): { elapsedMinutes: number; state: SlaState; running: boolean } {
  const end = c.onSiteAt ? Date.parse(c.onSiteAt) : c.closedAt ? Date.parse(c.closedAt) : now
  const elapsedMinutes = Math.max(0, Math.floor((end - Date.parse(c.receivedAt)) / 60_000))
  const running = !c.onSiteAt && !c.closedAt
  let state: SlaState = 'ok'
  if (elapsedMinutes > c.slaMinutes) state = 'breached'
  else if (running && elapsedMinutes >= c.slaMinutes * AT_RISK_RATIO) state = 'at_risk'
  return { elapsedMinutes, state, running }
}

/** "1 ч 05 мин" / "1 h 05 min" style is locale-neutral enough: hours and minutes as numbers. */
export function formatMinutes(
  min: number,
  t: (k: string, p?: Record<string, string | number>) => string,
): string {
  if (min < 60) return t('callbacks.responseMinutes', { count: min })
  const h = Math.floor(min / 60)
  const m = min % 60
  return t('callbacks.hoursMinutes', { hours: h, minutes: String(m).padStart(2, '0') })
}

export function slaBadgeKind(state: SlaState): 'ok' | 'warn' | 'danger' {
  return state === 'ok' ? 'ok' : state === 'at_risk' ? 'warn' : 'danger'
}
