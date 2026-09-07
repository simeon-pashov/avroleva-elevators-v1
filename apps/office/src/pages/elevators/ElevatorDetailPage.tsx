import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import type { ElevatorDto } from '@avroleva/contracts'
import { del, get } from '../../lib/api'
import { useI18n } from '../../i18n/I18nProvider'
import { useAuth } from '../../auth/AuthProvider'
import { Badge, ConfirmButton, ErrorBox, PageHeader, Spinner, toast } from '../../components/ui'
import { dueBadge, elevatorStatusBadge } from './ElevatorsListPage'

export function ElevatorDetailPage() {
  const { id } = useParams()
  const { t, date } = useI18n()
  const { hasRole } = useAuth()
  const navigate = useNavigate()
  const [e, setE] = useState<ElevatorDto | null>(null)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    get<ElevatorDto>(`/elevators/${id}`).then(setE).catch(setError)
  }, [id])

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
          canEdit ? (
            <>
              <Link className="btn btn-primary" to={`/elevators/${e.id}/edit`}>
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
          ) : null
        }
      />
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
            <dd>{dueBadge(e.nextCheckDue, t, date)}</dd>
            <dt>{t('elevators.nextInspectionAt')}</dt>
            <dd>{e.nextInspectionAt ? date(e.nextInspectionAt) : dash}</dd>
            <dt>{t('elevators.alarmDevicePhone')}</dt>
            <dd>{e.alarmDevicePhone ?? dash}</dd>
            <dt>{t('elevators.alarmSimOperator')}</dt>
            <dd>{e.alarmSimOperator ?? dash}</dd>
            <dt>{t('common.notes')}</dt>
            <dd className="pre">{e.notes ?? dash}</dd>
          </dl>
          <p className="muted small">{t('elevators.historyComingSoon')}</p>
        </div>
      </div>
    </div>
  )
}
