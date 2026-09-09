import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import type { JobsSummaryDto } from '@avroleva/contracts'
import { get } from '../../lib/api'
import { useI18n } from '../../i18n/I18nProvider'
import { Badge } from '../../components/ui'

/**
 * "Ремонти" on the dashboard, one compact strip like the deadlines strip: open quotes, awaiting
 * approval (with how many are past the reminder window), scheduled this week and the money
 * leaking (done, not invoiced). Owner/office only.
 */
export function JobsStrip({ version }: { version: number }) {
  const { t, money } = useI18n()
  const [s, setS] = useState<JobsSummaryDto | null>(null)
  useEffect(() => {
    let cancelled = false
    get<JobsSummaryDto>('/jobs/summary')
      .then((d) => !cancelled && setS(d))
      .catch(() => !cancelled && setS(null))
    return () => {
      cancelled = true
    }
  }, [version])
  if (!s) return null
  return (
    <div className="card widget-compact jobs-strip">
      <div className="card-head">
        <h2>{t('jobs.title')}</h2>
        <Link className="small" to="/jobs">
          {t('jobs.openBoard')}
        </Link>
      </div>
      <div className="strip-items">
        <Link to="/jobs?status=quoted,awaiting_approval&view=list" className="strip-item">
          <Badge kind={s.openQuotes.count ? 'info' : 'muted'}>
            {t('jobs.strip.openQuotes')} <b>{s.openQuotes.count}</b>
          </Badge>
          <span className="small muted">{money(s.openQuotes.cents)}</span>
        </Link>
        <Link to="/jobs?status=awaiting_approval&view=list" className="strip-item">
          <Badge
            kind={
              s.awaitingApproval.overdue ? 'danger' : s.awaitingApproval.count ? 'warn' : 'muted'
            }
          >
            {t('jobs.strip.awaiting')} <b>{s.awaitingApproval.count}</b>
          </Badge>
          {s.awaitingApproval.overdue ? (
            <span className="small text-danger">
              {t('jobs.strip.awaitingOverdue', { count: s.awaitingApproval.overdue })}
            </span>
          ) : null}
        </Link>
        <Link to="/jobs?status=scheduled,in_progress" className="strip-item">
          <Badge kind={s.scheduledThisWeek.count || s.inProgress.count ? 'info' : 'muted'}>
            {t('jobs.strip.thisWeek')} <b>{s.scheduledThisWeek.count}</b>
          </Badge>
          {s.inProgress.count ? (
            <span className="small muted">
              {t('jobs.strip.inProgress', { count: s.inProgress.count })}
            </span>
          ) : null}
        </Link>
        <Link to="/jobs?status=done&view=list" className="strip-item">
          <Badge kind={s.doneNotInvoiced.count ? 'danger' : 'ok'}>
            {t('jobs.strip.doneNotInvoiced')} <b>{s.doneNotInvoiced.count}</b>
          </Badge>
          <span className={`small ${s.doneNotInvoiced.cents ? 'text-danger' : 'muted'}`}>
            {money(s.doneNotInvoiced.cents)}
          </span>
        </Link>
      </div>
    </div>
  )
}
