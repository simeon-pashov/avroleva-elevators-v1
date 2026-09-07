import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import type { ElevatorDetailDto } from '@avroleva/contracts'
import { get } from '../lib/api'
import { useI18n } from '../i18n/I18nProvider'
import { useAuth } from '../auth/AuthProvider'
import { Badge, ErrorBox, Spinner } from './ui'
import { RecordVisitForm } from './RecordVisitForm'
import { ElevatorTabs } from './ElevatorTabs'
import { dueBadge, elevatorStatusBadge, overrideBadge } from '../pages/elevators/ElevatorsListPage'

/**
 * Right-side drawer with everything the office needs about one elevator: identity, the house
 * manager's phone, due dates, then the history / payments tabs. Reusable from any list.
 */
export function ElevatorPanel({
  elevatorId,
  onClose,
  onChanged,
}: {
  elevatorId: string
  onClose: () => void
  /** Called after a mutation inside the panel (a recorded visit) so lists/pins can refresh. */
  onChanged?: () => void
}) {
  const { t, date, moneyFull } = useI18n()
  const { hasRole } = useAuth()
  const canSeeMoney = hasRole('owner', 'office')
  const [e, setE] = useState<ElevatorDetailDto | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [version, setVersion] = useState(0)
  const [recording, setRecording] = useState(false)

  useEffect(() => {
    let cancelled = false
    setError(null)
    get<ElevatorDetailDto>(`/elevators/${elevatorId}`)
      .then((d) => !cancelled && setE(d))
      .catch((err) => !cancelled && setError(err))
    return () => {
      cancelled = true
    }
  }, [elevatorId, version])

  useEffect(() => {
    setRecording(false)
  }, [elevatorId])

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const dash = <span className="muted">—</span>
  const entranceLabel = e?.buildingEntrance
    ? `${t('address.entranceShort')} ${e.buildingEntrance}`
    : null

  return (
    <div className="drawer-root">
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={t('elevators.one')}>
        <div className="drawer-head">
          <div>
            <div className="muted small">{t('elevators.one')}</div>
            <h2>
              {e ? e.internalNo : '…'}
              {e?.regNo ? <span className="muted"> · {e.regNo}</span> : null}
            </h2>
          </div>
          <button
            type="button"
            className="btn btn-small drawer-close"
            onClick={onClose}
            aria-label={t('common.close')}
            title={t('common.close')}
          >
            ×
          </button>
        </div>
        <ErrorBox error={error} />
        {!e ? (
          <Spinner />
        ) : (
          <>
            <div className="actions drawer-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setRecording((v) => !v)}
              >
                {t('visits.record')}
              </button>
              <Link className="btn" to={`/elevators/${e.id}`} onClick={onClose}>
                {t('elevators.goTo')}
              </Link>
            </div>
            {recording ? (
              <div className="inset">
                <RecordVisitForm
                  elevatorId={e.id}
                  onDone={() => {
                    setRecording(false)
                    setVersion((v) => v + 1)
                    onChanged?.()
                  }}
                  onCancel={() => setRecording(false)}
                />
              </div>
            ) : null}
            <dl className="dl">
              <dt>{t('elevators.status')}</dt>
              <dd>
                <Badge kind={elevatorStatusBadge(e.status)}>
                  {t(`enum.elevatorStatus.${e.status}`)}
                </Badge>
              </dd>
              <dt>{t('elevators.address')}</dt>
              <dd>
                <Link to={`/buildings/${e.buildingId}`}>{e.buildingAddressText}</Link>
                {entranceLabel && !e.buildingAddressText.includes(entranceLabel)
                  ? `, ${entranceLabel}`
                  : null}
              </dd>
              <dt>{t('elevators.customer')}</dt>
              <dd>
                {e.customerId && e.customerName ? (
                  <Link to={`/customers/${e.customerId}`}>{e.customerName}</Link>
                ) : (
                  dash
                )}
              </dd>
              <dt>{t('elevators.contact')}</dt>
              <dd>
                {e.contact ? (
                  <>
                    {e.contact.name}
                    {e.contact.phone ? (
                      <>
                        {' · '}
                        <a href={`tel:${e.contact.phone}`}>{e.contact.phone}</a>
                      </>
                    ) : null}
                  </>
                ) : (
                  <span className="muted">{t('elevators.noContact')}</span>
                )}
              </dd>
              {canSeeMoney ? (
                <>
                  <dt>{t('contracts.monthlyPrice')}</dt>
                  <dd>
                    {e.monthlyPriceCents != null ? (
                      <>
                        {moneyFull(e.monthlyPriceCents)}
                        {e.contractId ? (
                          <>
                            {' '}
                            <Link className="small" to={`/contracts/${e.contractId}`}>
                              {t('contracts.one')}
                            </Link>
                          </>
                        ) : null}
                      </>
                    ) : (
                      <span className="muted">{t('elevators.noContract')}</span>
                    )}
                  </dd>
                </>
              ) : null}
              <dt>{t('elevators.nextCheckDue')}</dt>
              <dd>
                {dueBadge(e.nextCheckDue, t, date)}
                {overrideBadge(e.nextCheckOverrideAt, t)}
              </dd>
              <dt>{t('elevators.lastCheckAt')}</dt>
              <dd>{e.lastCheckAt ? date(e.lastCheckAt) : dash}</dd>
              <dt>{t('elevators.nextInspectionAt')}</dt>
              <dd>{e.nextInspectionAt ? date(e.nextInspectionAt) : dash}</dd>
              <dt>{t('elevators.stops')}</dt>
              <dd>{e.stops}</dd>
              <dt>{t('elevators.driveType')}</dt>
              <dd>
                {t(`enum.driveType.${e.driveType}`)}
                {' · '}
                {t(`enum.doorType.${e.doorType}`)}
              </dd>
              <dt>{t('elevators.manufacturer')}</dt>
              <dd>{[e.manufacturer, e.year].filter(Boolean).join(', ') || dash}</dd>
            </dl>
            <ElevatorTabs elevatorId={e.id} version={version} />
          </>
        )}
      </aside>
    </div>
  )
}
