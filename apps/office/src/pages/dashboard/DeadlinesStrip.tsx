import { Link } from 'react-router'
import type { DashboardDto } from '@avroleva/contracts'
import { CalendarItemKind } from '@avroleva/contracts'
import { useI18n } from '../../i18n/I18nProvider'
import { Badge } from '../../components/ui'
import { kindBadge } from '../calendar/CalendarPage'

/** "Срокове" strip: next-30-days counts per kind, overdue first. One line, links to the calendar. */
export function DeadlinesStrip({ deadlines }: { deadlines: DashboardDto['deadlines'] | null }) {
  const { t } = useI18n()
  return (
    <div className="card widget-compact strip">
      <div className="card-head">
        <h2>
          {t('calendar.stripTitle')}{' '}
          <span className="muted small">
            {deadlines ? t('calendar.stripNext', { days: deadlines.days }) : ''}
          </span>
        </h2>
        <Link className="btn btn-small" to="/calendar">
          {t('calendar.stripAll')}
        </Link>
      </div>
      {deadlines ? (
        <div className="strip-items">
          {deadlines.overdue > 0 ? (
            <Badge kind="danger">
              {t('calendar.overdue')} <b>{deadlines.overdue}</b>
            </Badge>
          ) : null}
          {CalendarItemKind.options.map((k) => (
            <Badge key={k} kind={deadlines.byKind[k] > 0 ? kindBadge(k) : 'muted'}>
              {t(`enum.calendarKind.${k}`)} <b>{deadlines.byKind[k]}</b>
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  )
}
