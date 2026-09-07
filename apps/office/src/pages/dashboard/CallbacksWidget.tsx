import { Link } from 'react-router'
import type { CallbacksSummaryDto } from '@avroleva/contracts'
import { useI18n } from '../../i18n/I18nProvider'
import { Badge } from '../../components/ui'
import { CallbackTimer } from '../../components/callbacks/CallbackTimer'

/** "Открити аварии": count with SLA badges and the oldest open callback with its live timer. */
export function CallbacksWidget({
  summary,
  onOpen,
}: {
  summary: CallbacksSummaryDto | null
  onOpen: (elevatorId: string) => void
}) {
  const { t, dateTime } = useI18n()
  const s = summary
  return (
    <div
      className={`card widget-compact cb-widget${s && s.breached > 0 ? ' cb-widget-alert' : ''}`}
    >
      <div className="card-head">
        <h2>
          {t('callbacks.widgetTitle')} {s ? <span className="count-pill">{s.open}</span> : null}
        </h2>
        <div className="due-counts">
          {s && s.breached > 0 ? (
            <Badge kind="danger">{t('callbacks.badgeBreached', { count: s.breached })}</Badge>
          ) : null}
          {s && s.atRisk > 0 ? (
            <Badge kind="warn">{t('callbacks.badgeAtRisk', { count: s.atRisk })}</Badge>
          ) : null}
          {s && s.trapped > 0 ? (
            <Badge kind="danger">{t('callbacks.badgeTrapped', { count: s.trapped })}</Badge>
          ) : null}
          <Link className="btn btn-small" to="/callbacks">
            {t('callbacks.widgetAll')}
          </Link>
          <Link className="btn btn-small btn-primary" to="/callbacks?new=1">
            {t('callbacks.new')}
          </Link>
        </div>
      </div>
      {!s ? null : s.open === 0 || !s.oldest ? (
        <p className="muted small">{t('callbacks.widgetNone')}</p>
      ) : (
        <div className="cb-oldest">
          <span className="muted small">{t('callbacks.widgetOldest')}:</span>{' '}
          <CallbackTimer c={s.oldest} showLimit />{' '}
          <button type="button" className="linkish" onClick={() => onOpen(s.oldest!.elevatorId)}>
            <strong>{s.oldest.elevatorInternalNo}</strong>
          </button>
          {' · '}
          {s.oldest.buildingAddressText}
          {' · '}
          <span className="muted small">{dateTime(s.oldest.receivedAt)}</span>
          {' · '}
          <Badge kind={s.oldest.classification === 'trapped_persons' ? 'danger' : 'muted'}>
            {t(`enum.callbackClassification.${s.oldest.classification}`)}
          </Badge>
        </div>
      )}
    </div>
  )
}
