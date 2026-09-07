import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import type { ElevatorDetailDto } from '@avroleva/contracts'
import { del, get } from '../../lib/api'
import { useI18n } from '../../i18n/I18nProvider'
import { useAuth } from '../../auth/AuthProvider'
import { Badge, ConfirmButton, ErrorBox, PageHeader, Spinner, toast } from '../../components/ui'
import { ElevatorTabs } from '../../components/ElevatorTabs'
import { RecordVisitForm } from '../../components/RecordVisitForm'
import { dueBadge, elevatorStatusBadge, overrideBadge } from './ElevatorsListPage'

export function ElevatorDetailPage() {
  const { id } = useParams()
  const { t, date, moneyFull } = useI18n()
  const { hasRole } = useAuth()
  const navigate = useNavigate()
  const [e, setE] = useState<ElevatorDetailDto | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [version, setVersion] = useState(0)
  const [recording, setRecording] = useState(false)

  const load = useCallback(
    () => get<ElevatorDetailDto>(`/elevators/${id}`).then(setE).catch(setError),
    [id],
  )
  useEffect(() => {
    void load()
  }, [load])

  if (error) return <ErrorBox error={error} />
  if (!e) return <Spinner />
  const canEdit = hasRole('owner', 'office')
  const dash = <span className="muted">—</span>

  return (
    <div>
      <PageHeader
        back={
          <Link to={`/buildings/${e.buildingId}`} className="back">
            {e.buildingAddressText}
          </Link>
        }
        title={`${t('elevators.one')} ${e.internalNo}`}
        actions={
          <>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setRecording((v) => !v)}
            >
              {t('visits.record')}
            </button>
            {canEdit ? (
              <>
                <Link className="btn" to={`/elevators/${e.id}/edit`}>
                  {t('common.edit')}
                </Link>
                {e.status === 'scrapped' || e.status === 'out_of_contract' ? (
                  <ConfirmButton
                    label={t('common.archive')}
                    onConfirm={async () => {
                      await del(`/elevators/${e.id}`)
                      toast(t('common.archived'))
                      navigate(`/buildings/${e.buildingId}`)
                    }}
                  />
                ) : null}
              </>
            ) : null}
          </>
        }
      />
      {recording ? (
        <div className="card narrow">
          <h2>{t('visits.record')}</h2>
          <RecordVisitForm
            elevatorId={e.id}
            onDone={() => {
              setRecording(false)
              setVersion((v) => v + 1)
              void load()
            }}
            onCancel={() => setRecording(false)}
          />
        </div>
      ) : null}
      <div className="grid-2">
        <div className="card">
          <h2>{t('elevators.identity')}</h2>
          <dl className="dl">
            <dt>{t('elevators.status')}</dt>
            <dd>
              <Badge kind={elevatorStatusBadge(e.status)}>
                {t(`enum.elevatorStatus.${e.status}`)}
              </Badge>
            </dd>
            <dt>{t('elevators.regNo')}</dt>
            <dd>{e.regNo ?? dash}</dd>
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
            {canEdit ? (
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
            <dt>{t('elevators.inspectionBody')}</dt>
            <dd>{e.inspectionBody ?? dash}</dd>
            <dt>{t('elevators.manufacturer')}</dt>
            <dd>{e.manufacturer ?? dash}</dd>
            <dt>{t('elevators.year')}</dt>
            <dd>{e.year ?? dash}</dd>
            <dt>{t('elevators.driveType')}</dt>
            <dd>{t(`enum.driveType.${e.driveType}`)}</dd>
            <dt>{t('elevators.doorType')}</dt>
            <dd>{t(`enum.doorType.${e.doorType}`)}</dd>
            <dt>{t('elevators.stops')}</dt>
            <dd>{e.stops}</dd>
            <dt>{t('elevators.loadKg')}</dt>
            <dd>{e.loadKg ?? dash}</dd>
            <dt>{t('elevators.publicCode')}</dt>
            <dd>
              <code>{e.publicCode}</code>
            </dd>
          </dl>
        </div>
        <div className="card">
          <h2>{t('elevators.schedule')}</h2>
          <dl className="dl">
            <dt>{t('elevators.interval')}</dt>
            <dd>
              {t('elevators.days', { count: e.effectiveIntervalDays })}
              {e.checkIntervalDays == null ? (
                <span className="muted"> ({t('elevators.tenantDefault')})</span>
              ) : null}
            </dd>
            <dt>{t('elevators.lastCheckAt')}</dt>
            <dd>{e.lastCheckAt ? date(e.lastCheckAt) : dash}</dd>
            <dt>{t('elevators.nextCheckDue')}</dt>
            <dd>
              {dueBadge(e.nextCheckDue, t, date)}
              {overrideBadge(e.nextCheckOverrideAt, t)}
            </dd>
            <dt>{t('elevators.nextInspectionAt')}</dt>
            <dd>{e.nextInspectionAt ? date(e.nextInspectionAt) : dash}</dd>
            <dt>{t('elevators.alarmDevicePhone')}</dt>
            <dd>{e.alarmDevicePhone ?? dash}</dd>
            <dt>{t('elevators.alarmSimOperator')}</dt>
            <dd>{e.alarmSimOperator ?? dash}</dd>
            <dt>{t('common.notes')}</dt>
            <dd className="pre">{e.notes ?? dash}</dd>
          </dl>
        </div>
      </div>
      <div className="card">
        <ElevatorTabs elevatorId={e.id} version={version} />
      </div>
    </div>
  )
}
