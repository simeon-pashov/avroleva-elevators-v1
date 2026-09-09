import { Link } from 'react-router'
import type { JobDto, JobStageDto } from '@avroleva/contracts'
import { useI18n } from '../../i18n/I18nProvider'
import { Badge, Empty } from '../ui'
import { stageBadge, stageLabel } from './jobsConfig'

/** Compact job rows (elevator tab, list view of the board). */
export function JobList({
  items,
  stages,
  showElevator = true,
  emptyText,
}: {
  items: JobDto[]
  stages?: JobStageDto[]
  showElevator?: boolean
  emptyText?: string
}) {
  const { t, locale, date, dateTime, moneyFull } = useI18n()
  if (items.length === 0) return <Empty text={emptyText ?? t('jobs.empty')} />
  return (
    <ul className="list job-list">
      {items.map((j) => (
        <li key={j.id} className="job-row">
          <div className="cb-main">
            <div className="cb-head">
              <Badge kind={stageBadge(j.status)}>{stageLabel(stages, j.status, locale, t)}</Badge>
              <Badge kind="muted">{t(`enum.jobKind.${j.kind}`)}</Badge>
              {j.status === 'done' && j.netCents - j.invoicedCents > 0 ? (
                <Badge kind="danger">{t('jobs.notInvoiced')}</Badge>
              ) : null}
            </div>
            <div>
              <Link to={`/jobs/${j.id}`}>
                <strong>{j.title}</strong>
              </Link>
              {' · '}
              <span>{moneyFull(j.totalCents)}</span>
            </div>
            {showElevator ? (
              <div className="small">
                <Link to={`/elevators/${j.elevatorId}`}>{j.elevatorInternalNo}</Link>
                {' · '}
                <Link to={`/buildings/${j.buildingId}`}>{j.buildingAddressText}</Link>
              </div>
            ) : null}
            <div className="small muted">
              {t('jobs.createdAt')}: {date(j.createdAt)}
              {j.scheduledAt ? ` · ${t('jobs.scheduledAt')}: ${dateTime(j.scheduledAt)}` : ''}
              {j.assignedUserNames.length ? ` · ${j.assignedUserNames.join(', ')}` : ''}
              {j.completedAt ? ` · ${t('jobs.completedAt')}: ${date(j.completedAt)}` : ''}
            </div>
          </div>
          <div className="actions cb-actions">
            <Link className="btn btn-small" to={`/jobs/${j.id}`}>
              {t('common.open')}
            </Link>
          </div>
        </li>
      ))}
    </ul>
  )
}
