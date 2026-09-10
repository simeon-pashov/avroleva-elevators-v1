import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import type { BuildingDto, GeocodeStatus, Page, ZoneDto } from '@avroleva/contracts'
import { GeocodeStatus as GeocodeStatusEnum } from '@avroleva/contracts'
import { get, qs } from '../../lib/api'
import { useI18n } from '../../i18n/I18nProvider'
import { useAuth } from '../../auth/AuthProvider'
import {
  Badge,
  Empty,
  ErrorBox,
  LoadMore,
  PageHeader,
  SearchBox,
  Spinner,
  useCursorList,
} from '../../components/ui'
import { EnumSelect } from '../../components/EnumSelect'
import { ExportCsvButton } from '../../components/ExportCsvButton'
import { PlaceOnMapDialog } from '../../components/PlaceOnMapDialog'

export function geocodeBadge(status: GeocodeStatus) {
  return status === 'ok' || status === 'manual' ? 'ok' : status === 'failed' ? 'danger' : 'warn'
}

export function BuildingsListPage() {
  const { t } = useI18n()
  const { hasRole } = useAuth()
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const customerId = params.get('customerId') ?? ''
  const zoneId = params.get('zoneId') ?? ''
  const [zones, setZones] = useState<ZoneDto[]>([])
  const [geocodeStatus, setGeocodeStatus] = useState<GeocodeStatus | ''>(
    params.get('geocodeStatus') === 'pending' ? 'pending' : '',
  )
  const [placing, setPlacing] = useState<BuildingDto | null>(null)
  const canEdit = hasRole('owner', 'office')
  const list = useCursorList<BuildingDto>(
    (cursor) =>
      get<Page<BuildingDto>>(
        `/buildings${qs({ q, customerId, geocodeStatus, zoneId, cursor, limit: 50 })}`,
      ),
    [q, customerId, geocodeStatus, zoneId],
  )

  useEffect(() => {
    get<{ items: ZoneDto[] }>('/zones')
      .then((r) => setZones(r.items))
      .catch(() => setZones([]))
  }, [])

  return (
    <div>
      <PageHeader
        title={t('buildings.title')}
        actions={
          hasRole('owner', 'office') ? (
            <>
              <ExportCsvButton dataset="buildings" />
              <Link className="btn btn-primary" to="/buildings/new">
                {t('buildings.new')}
              </Link>
            </>
          ) : null
        }
      />
      <div className="toolbar">
        <SearchBox
          value={q}
          onChange={(v) => setParams((p) => (v ? (p.set('q', v), p) : (p.delete('q'), p)))}
          placeholder={t('buildings.searchPlaceholder')}
        />
        <select
          value={zoneId}
          aria-label={t('buildings.zone')}
          onChange={(e) => {
            const v = e.target.value
            setParams((p) => (v ? (p.set('zoneId', v), p) : (p.delete('zoneId'), p)))
          }}
        >
          <option value="">{t('buildings.allZones')}</option>
          {zones.map((z) => (
            <option key={z.id} value={z.id}>
              {z.name}
            </option>
          ))}
        </select>
        <EnumSelect
          value={geocodeStatus}
          options={GeocodeStatusEnum.options}
          prefix="enum.geocodeStatus"
          onChange={setGeocodeStatus}
          allowEmpty
          emptyLabel={t('buildings.allGeocode')}
        />
        <button
          type="button"
          className={`btn btn-small${geocodeStatus === 'pending' ? ' btn-primary' : ''}`}
          onClick={() => setGeocodeStatus(geocodeStatus === 'pending' ? '' : 'pending')}
        >
          {t('geo.withoutCoordinates')}
        </button>
      </div>
      {placing ? (
        <PlaceOnMapDialog
          building={placing}
          onClose={() => setPlacing(null)}
          onSaved={() => {
            setPlacing(null)
            list.reload()
          }}
        />
      ) : null}
      <ErrorBox error={list.error} />
      {list.loading && list.items.length === 0 ? (
        <Spinner />
      ) : list.items.length === 0 ? (
        <Empty />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('buildings.address')}</th>
                <th>{t('buildings.customer')}</th>
                <th>{t('buildings.zone')}</th>
                <th className="num">{t('buildings.elevators')}</th>
                <th>{t('buildings.location')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.items.map((b) => (
                <tr key={b.id}>
                  <td>
                    <Link to={`/buildings/${b.id}`}>{b.addressText}</Link>
                  </td>
                  <td>{b.customerName ?? <span className="muted">—</span>}</td>
                  <td>{b.zoneName ?? <span className="muted">—</span>}</td>
                  <td className="num">{b.elevatorCount ?? 0}</td>
                  <td>
                    <Badge kind={geocodeBadge(b.geocodeStatus)}>
                      {t(`enum.geocodeStatus.${b.geocodeStatus}`)}
                    </Badge>
                  </td>
                  <td>
                    {canEdit && (b.geocodeStatus === 'pending' || b.geocodeStatus === 'failed') ? (
                      <button type="button" className="btn btn-small" onClick={() => setPlacing(b)}>
                        {t('geo.placeOnMap')}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <LoadMore hasMore={list.hasMore} loading={list.loading} onClick={list.loadMore} />
    </div>
  )
}
