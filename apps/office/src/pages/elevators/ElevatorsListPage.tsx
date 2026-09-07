import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import type { ElevatorDto, ElevatorStatus, Page } from '@avroleva/contracts'
import { ElevatorStatus as ElevatorStatusEnum } from '@avroleva/contracts'
import type { T } from '@avroleva/i18n'
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

export function elevatorStatusBadge(status: ElevatorStatus): 'ok' | 'warn' | 'danger' | 'muted' {
  switch (status) {
    case 'active':
      return 'ok'
    case 'stopped_by_firm':
      return 'warn'
    case 'stopped_by_authority':
      return 'danger'
    default:
      return 'muted'
  }
}

function todaySofia(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Sofia' }).format(new Date())
}

/** Due-date cell: overdue (red), today (orange), tomorrow (yellow), later (plain). */
export function dueBadge(nextCheckDue: string | null, t: T, date: (d: string | null) => string) {
  if (!nextCheckDue) return <span className="muted">{t('elevators.neverChecked')}</span>
  const today = todaySofia()
  const diff = Math.round((Date.parse(nextCheckDue) - Date.parse(today)) / 86_400_000)
  if (diff < 0) return <Badge kind="danger">{t('elevators.overdueBy', { count: -diff })}</Badge>
  if (diff === 0) return <Badge kind="warn">{t('elevators.dueToday')}</Badge>
  if (diff === 1) return <Badge kind="info">{t('elevators.dueTomorrow')}</Badge>
  return <span>{date(nextCheckDue)}</span>
}

export function ElevatorsListPage() {
  const { t, date } = useI18n()
  const { hasRole } = useAuth()
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const buildingId = params.get('buildingId') ?? ''
  const [status, setStatus] = useState<ElevatorStatus | ''>('')
  const list = useCursorList<ElevatorDto>(
    (cursor) =>
      get<Page<ElevatorDto>>(`/elevators${qs({ q, buildingId, status, cursor, limit: 50 })}`),
    [q, buildingId, status],
  )

  return (
    <div>
      <PageHeader
        title={t('elevators.title')}
        actions={
          hasRole('owner', 'office') ? (
            <Link className="btn btn-primary" to="/elevators/new">
              {t('elevators.new')}
            </Link>
          ) : null
        }
      />
      <div className="toolbar">
        <SearchBox
          value={q}
          onChange={(v) => setParams((p) => (v ? (p.set('q', v), p) : (p.delete('q'), p)))}
          placeholder={t('elevators.searchPlaceholder')}
        />
        <EnumSelect
          value={status}
          options={ElevatorStatusEnum.options}
          prefix="enum.elevatorStatus"
          onChange={setStatus}
          allowEmpty
          emptyLabel={t('elevators.allStatuses')}
        />
      </div>
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
                <th>{t('elevators.internalNo')}</th>
                <th>{t('elevators.regNo')}</th>
                <th>{t('elevators.status')}</th>
                <th>{t('elevators.interval')}</th>
                <th>{t('elevators.lastCheckAt')}</th>
                <th>{t('elevators.nextCheckDue')}</th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((e) => (
                <tr key={e.id}>
                  <td>
                    <Link to={`/buildings/${e.buildingId}`}>{e.buildingAddressText}</Link>
                  </td>
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
                  <td>{dueBadge(e.nextCheckDue, t, date)}</td>
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
