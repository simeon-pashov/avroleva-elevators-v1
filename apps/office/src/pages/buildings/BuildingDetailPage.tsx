import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import type { BuildingDetailDto, ContactDto, GeocodeResultDto } from '@avroleva/contracts'
import { BASE, del, get, post, put } from '../../lib/api'
import { useI18n } from '../../i18n/I18nProvider'
import { useAuth } from '../../auth/AuthProvider'
import { Badge, ConfirmButton, ErrorBox, PageHeader, Spinner, toast } from '../../components/ui'
import { MapPicker } from '../../components/MapPicker'
import { geocodeBadge } from './BuildingsListPage'
import { ElevatorPanel } from '../../components/ElevatorPanel'
import { ContactsPanel } from '../customers/ContactsPanel'
import { elevatorStatusBadge, dueBadge, overrideBadge } from '../elevators/ElevatorsListPage'
import { BuildingViberCard } from './BuildingViberCard'
import { BuildingReportCard } from './BuildingReportCard'
import { BuildingStatementCard } from './BuildingStatementCard'

export function BuildingDetailPage() {
  const { id } = useParams()
  const { t, date, money } = useI18n()
  const { hasRole } = useAuth()
  const canSeeMoney = hasRole('owner', 'office')
  const navigate = useNavigate()
  const [b, setB] = useState<BuildingDetailDto | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [panelId, setPanelId] = useState<string | null>(null)
  const canEdit = hasRole('owner', 'office')

  const load = useCallback(async () => {
    try {
      const data = await get<BuildingDetailDto>(`/buildings/${id}`)
      setB(data)
      setPin(data.lat != null && data.lng != null ? { lat: data.lat, lng: data.lng } : null)
    } catch (e) {
      setError(e)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  if (error) return <ErrorBox error={error} />
  if (!b) return <Spinner />

  const dirty = !!pin && (pin.lat !== b.lat || pin.lng !== b.lng)

  const savePin = async () => {
    if (!pin) return
    setBusy(true)
    try {
      await put(`/buildings/${b.id}/location`, pin)
      toast(t('buildings.pinSaved'))
      await load()
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  const geocode = async () => {
    setBusy(true)
    try {
      const r = await post<GeocodeResultDto>(`/buildings/${b.id}/geocode`)
      toast(
        r.status === 'ok' ? t('buildings.geocodeOk') : t('buildings.geocodeFailed'),
        r.status === 'ok' ? 'ok' : 'error',
      )
      await load()
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHeader
        back={
          <Link to="/buildings" className="back">
            {t('buildings.title')}
          </Link>
        }
        title={b.addressText}
        actions={
          canEdit ? (
            <>
              <a
                className="btn"
                href={`${BASE}/print/labels/building/${b.id}`}
                target="_blank"
                rel="noopener"
              >
                {t('label.printAll')}
              </a>
              <Link className="btn" to={`/buildings/${b.id}/edit`}>
                {t('common.edit')}
              </Link>
              <Link className="btn btn-primary" to={`/elevators/new?buildingId=${b.id}`}>
                {t('elevators.new')}
              </Link>
              {b.elevators.length === 0 ? (
                <ConfirmButton
                  label={t('common.archive')}
                  onConfirm={async () => {
                    await del(`/buildings/${b.id}`)
                    toast(t('common.archived'))
                    navigate('/buildings')
                  }}
                />
              ) : null}
            </>
          ) : null
        }
      />

      <div className="grid-2">
        <div className="card">
          <h2>{t('buildings.details')}</h2>
          <dl className="dl">
            <dt>{t('buildings.customer')}</dt>
            <dd>
              {b.customerId ? (
                <Link to={`/customers/${b.customerId}`}>{b.customerName}</Link>
              ) : (
                <span className="muted">—</span>
              )}
            </dd>
            <dt>{t('address.city')}</dt>
            <dd>{[b.address.postcode, b.address.city].filter(Boolean).join(' ')}</dd>
            <dt>{t('address.district')}</dt>
            <dd>{b.address.district ?? '—'}</dd>
            <dt>{t('address.street')}</dt>
            <dd>{[b.address.street, b.address.number].filter(Boolean).join(' ') || '—'}</dd>
            <dt>{t('address.block')}</dt>
            <dd>
              {[
                b.address.block && `${t('address.blockShort')} ${b.address.block}`,
                b.address.entrance && `${t('address.entranceShort')} ${b.address.entrance}`,
              ]
                .filter(Boolean)
                .join(', ') || '—'}
            </dd>
            <dt>{t('buildings.accessNotes')}</dt>
            <dd className="pre">{b.accessNotes ?? '—'}</dd>
            <dt>{t('buildings.keysLocation')}</dt>
            <dd>{b.keysLocation ?? '—'}</dd>
            <dt>{t('common.notes')}</dt>
            <dd className="pre">{b.notes ?? '—'}</dd>
          </dl>
        </div>

        <div className="card">
          <div className="card-head">
            <h2>{t('buildings.location')}</h2>
            <Badge kind={geocodeBadge(b.geocodeStatus)}>
              {t(`enum.geocodeStatus.${b.geocodeStatus}`)}
              {b.geocodeConfidence != null ? ` · ${Math.round(b.geocodeConfidence * 100)}%` : ''}
            </Badge>
          </div>
          <MapPicker
            lat={pin?.lat ?? null}
            lng={pin?.lng ?? null}
            onChange={canEdit ? (lat, lng) => setPin({ lat, lng }) : undefined}
          />
          <div className="coords muted small">
            {pin ? `${pin.lat.toFixed(6)}, ${pin.lng.toFixed(6)}` : t('buildings.noCoordinates')}
          </div>
          {canEdit ? (
            <div className="actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={!dirty || busy}
                onClick={savePin}
              >
                {t('buildings.savePin')}
              </button>
              <button type="button" className="btn" disabled={busy} onClick={geocode}>
                {t('buildings.geocode')}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>{t('buildings.elevators')}</h2>
        </div>
        {b.elevators.length === 0 ? (
          <p className="muted">{t('buildings.noElevators')}</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('elevators.internalNo')}</th>
                  <th>{t('elevators.regNo')}</th>
                  <th>{t('elevators.status')}</th>
                  <th>{t('elevators.interval')}</th>
                  <th>{t('elevators.lastCheckAt')}</th>
                  <th>{t('elevators.nextCheckDue')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {b.elevators.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <Link to={`/elevators/${e.id}`}>{e.internalNo}</Link>
                    </td>
                    <td>{e.regNo ?? <span className="muted">—</span>}</td>
                    <td>
                      <Badge kind={elevatorStatusBadge(e.status)}>
                        {t(`enum.elevatorStatus.${e.status}`)}
                      </Badge>
                    </td>
                    <td>{t('elevators.days', { count: e.effectiveIntervalDays })}</td>
                    <td>{date(e.lastCheckAt)}</td>
                    <td>
                      {dueBadge(e.nextCheckDue, t, date)}
                      {overrideBadge(e.nextCheckOverrideAt, t)}
                    </td>
                    <td className="num">
                      <button
                        type="button"
                        className="btn btn-small"
                        onClick={() => setPanelId(e.id)}
                      >
                        {t('dashboard.open')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid-2">
        <ContactsPanel
          contacts={b.contacts}
          parent={{ buildingId: b.id, customerId: b.customerId }}
          onChange={load}
          canEdit={canEdit}
        />
        <div className="card">
          <div className="card-head">
            <h2>{t('contracts.title')}</h2>
            {canEdit ? (
              <Link
                className="btn btn-small"
                to={`/contracts/new?buildingId=${b.id}${b.customerId ? `&customerId=${b.customerId}` : ''}`}
              >
                {t('contracts.new')}
              </Link>
            ) : null}
          </div>
          {b.contracts.length === 0 ? (
            <p className="muted">{t('contracts.none')}</p>
          ) : (
            <ul className="list">
              {b.contracts.map((c) => (
                <li key={c.id}>
                  <Link to={`/contracts/${c.id}`}>
                    {date(c.startDate)} – {c.endDate ? date(c.endDate) : '…'}
                  </Link>{' '}
                  <Badge kind={c.status === 'active' ? 'ok' : 'muted'}>
                    {t(`enum.contractStatus.${c.status}`)}
                  </Badge>{' '}
                  {canSeeMoney ? (
                    <span className="muted">
                      {money(c.monthlyTotalCents)} / {t('contracts.month')}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="grid-2">
        <BuildingViberCard building={b} />
        {canEdit ? <BuildingReportCard building={b} /> : null}
      </div>
      {canSeeMoney ? (
        <div className="grid-2">
          <BuildingStatementCard building={b} />
        </div>
      ) : null}
      {panelId ? (
        <ElevatorPanel elevatorId={panelId} onClose={() => setPanelId(null)} onChanged={load} />
      ) : null}
    </div>
  )
}

export type { ContactDto }
