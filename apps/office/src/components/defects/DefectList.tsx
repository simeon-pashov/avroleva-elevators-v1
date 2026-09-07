import { useState } from 'react'
import { Link } from 'react-router'
import type { DefectDto, DefectStatus } from '@avroleva/contracts'
import { ApiError, BASE, patch } from '../../lib/api'
import { useI18n } from '../../i18n/I18nProvider'
import { useAuth } from '../../auth/AuthProvider'
import { Badge, Empty, toast } from '../ui'

export function defectStatusBadge(s: DefectStatus): 'ok' | 'warn' | 'danger' | 'muted' | 'info' {
  switch (s) {
    case 'open':
      return 'danger'
    case 'notified':
      return 'warn'
    case 'awaiting_approval':
      return 'info'
    case 'scheduled':
      return 'info'
    default:
      return 'ok'
  }
}

/** Defect rows with the status actions (office) and the printable notice link. */
export function DefectList({
  items,
  onChanged,
  showElevator = true,
  emptyText,
}: {
  items: DefectDto[]
  onChanged: () => void
  showElevator?: boolean
  emptyText?: string
}) {
  const { t, dateTime, date } = useI18n()
  const { hasRole } = useAuth()
  const isOffice = hasRole('owner', 'office')
  const [busyId, setBusyId] = useState<string | null>(null)

  const setStatus = async (d: DefectDto, status: DefectStatus) => {
    setBusyId(d.id)
    try {
      await patch(`/defects/${d.id}`, { status })
      toast(t('defects.updated'))
      onChanged()
    } catch (e) {
      toast(e instanceof ApiError ? e.problem.title : t('error.internal'), 'error')
    } finally {
      setBusyId(null)
    }
  }

  if (items.length === 0) return <Empty text={emptyText ?? t('defects.empty')} />
  return (
    <ul className="list defect-list">
      {items.map((d) => {
        const busy = busyId === d.id
        const open = d.status !== 'resolved'
        const overdue = open && d.followUpInDays < 0
        return (
          <li key={d.id} className={`defect-row${d.stopLift && open ? ' defect-stop' : ''}`}>
            <div className="cb-main">
              <div className="cb-head">
                {d.stopLift && open ? <Badge kind="danger">{t('defects.stopped')}</Badge> : null}
                <Badge kind={defectStatusBadge(d.status)}>
                  {t(`enum.defectStatus.${d.status}`)}
                </Badge>
                <Badge
                  kind={
                    d.severity === 'high' ? 'danger' : d.severity === 'medium' ? 'warn' : 'muted'
                  }
                >
                  {t(`enum.defectSeverity.${d.severity}`)}
                </Badge>
                {open ? (
                  <Badge kind={overdue ? 'danger' : 'muted'}>
                    {overdue
                      ? t('defects.followUpOverdue', { count: -d.followUpInDays })
                      : t('defects.followUpIn', { count: d.followUpInDays })}
                  </Badge>
                ) : null}
              </div>
              {showElevator ? (
                <div>
                  <Link to={`/elevators/${d.elevatorId}`}>
                    <strong>{d.elevatorInternalNo}</strong>
                  </Link>
                  {' · '}
                  <Link to={`/buildings/${d.buildingId}`}>{d.buildingAddressText}</Link>
                </div>
              ) : null}
              <div>
                {d.catalogRef ? <span className="muted">{d.catalogRef} · </span> : null}
                {d.description}
              </div>
              <div className="small muted">
                {t('defects.recordedAt')}: {dateTime(d.recordedAt)} ·{' '}
                {t(`enum.defectSource.${d.sourceType}`)}
                {d.noticeSentAt ? ` · ${t('defects.noticeSentAt')}: ${date(d.noticeSentAt)}` : ''}
                {d.customerRequestedAt
                  ? ` · ${t('defects.customerRequestedAt')}: ${date(d.customerRequestedAt)}`
                  : ''}
                {d.resolvedAt ? ` · ${t('defects.resolvedAt')}: ${date(d.resolvedAt)}` : ''}
              </div>
              {d.notes ? <div className="small pre">{d.notes}</div> : null}
            </div>
            {isOffice ? (
              <div className="actions cb-actions">
                {open ? (
                  <a
                    className="btn btn-small"
                    href={`${BASE}/print/defect-notice/${d.id}`}
                    target="_blank"
                    rel="noopener"
                  >
                    {t('defects.printNotice')}
                  </a>
                ) : null}
                {d.status === 'open' ? (
                  <button
                    type="button"
                    className="btn btn-small"
                    disabled={busy}
                    onClick={() => setStatus(d, 'notified')}
                  >
                    {t('defects.markNoticeSent')}
                  </button>
                ) : null}
                {d.status === 'open' || d.status === 'notified' ? (
                  <button
                    type="button"
                    className="btn btn-small"
                    disabled={busy}
                    onClick={() => setStatus(d, 'awaiting_approval')}
                  >
                    {t('defects.markRequested')}
                  </button>
                ) : null}
                {d.status === 'awaiting_approval' ? (
                  <button
                    type="button"
                    className="btn btn-small"
                    disabled={busy}
                    onClick={() => setStatus(d, 'scheduled')}
                  >
                    {t('defects.markScheduled')}
                  </button>
                ) : null}
                {open ? (
                  <button
                    type="button"
                    className="btn btn-small btn-primary"
                    disabled={busy}
                    onClick={() => setStatus(d, 'resolved')}
                  >
                    {t('defects.resolve')}
                  </button>
                ) : null}
              </div>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
