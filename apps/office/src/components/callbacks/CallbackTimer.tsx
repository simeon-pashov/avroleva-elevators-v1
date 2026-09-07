import type { CallbackDto } from '@avroleva/contracts'
import { useI18n } from '../../i18n/I18nProvider'
import { formatMinutes, liveSla, slaBadgeKind, useNow } from '../../lib/live'
import { Badge } from '../ui'

/**
 * Live response timer: minutes since the call came in (ticking), frozen at onSiteAt / closedAt.
 * Colour = ok / at risk (75 % of the limit) / over the limit, same rule as the API.
 */
export function CallbackTimer({ c, showLimit }: { c: CallbackDto; showLimit?: boolean }) {
  const { t } = useI18n()
  const now = useNow(15_000)
  const { elapsedMinutes, state, running } = liveSla(c, now)
  return (
    <span className="cb-timer">
      <Badge kind={slaBadgeKind(state)}>
        {running ? '⏱ ' : ''}
        {formatMinutes(elapsedMinutes, t)}
      </Badge>
      {showLimit ? (
        <span className="muted small"> {t('callbacks.limitMinutes', { count: c.slaMinutes })}</span>
      ) : null}
    </span>
  )
}

export function callbackStatusBadge(
  status: CallbackDto['status'],
): 'ok' | 'warn' | 'danger' | 'muted' | 'info' {
  switch (status) {
    case 'open':
      return 'danger'
    case 'dispatched':
      return 'warn'
    case 'on_site':
    case 'released':
      return 'info'
    case 'restored':
      return 'ok'
    default:
      return 'muted'
  }
}
