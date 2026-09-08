import type { DashboardDto } from '@avroleva/contracts'
import { useI18n } from '../../i18n/I18nProvider'

/** "Този месец": one quiet line under the header - visits done · callbacks · average response. */
export function ThisMonthStrip({ thisMonth }: { thisMonth: DashboardDto['thisMonth'] | null }) {
  const { t, locale } = useI18n()
  if (!thisMonth) return null
  const label = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(
    new Date(`${thisMonth.period}-01T12:00:00Z`),
  )
  return (
    <div className="card widget-compact strip strip-month">
      <div className="card-head">
        <h2>
          {t('dashboard.thisMonth')} <span className="muted small">{label}</span>
        </h2>
        <div className="strip-items strip-month-items muted small">
          <span>{t('dashboard.thisMonthVisits', { count: thisMonth.visits })}</span>
          <span>{t('dashboard.thisMonthCallbacks', { count: thisMonth.callbacks })}</span>
          <span>
            {thisMonth.avgResponseMinutes != null
              ? t('dashboard.thisMonthResponse', { minutes: thisMonth.avgResponseMinutes })
              : t('dashboard.thisMonthNoResponse')}
          </span>
        </div>
      </div>
    </div>
  )
}
