import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import type { BuildingDto, JobDto, JobKind, Page, UserDto } from '@avroleva/contracts'
import { JobKind as JobKindEnum } from '@avroleva/contracts'
import { get, qs } from '../../lib/api'
import { useI18n } from '../../i18n/I18nProvider'
import { useAuth } from '../../auth/AuthProvider'
import {
  Badge,
  ErrorBox,
  Field,
  LoadMore,
  PageHeader,
  SearchBox,
  Spinner,
  useCursorList,
} from '../../components/ui'
import { EnumSelect } from '../../components/EnumSelect'
import { JobList } from '../../components/jobs/JobList'
import { stageBadge, stageLabel, useJobsConfig } from '../../components/jobs/jobsConfig'

type View = 'board' | 'list'

/**
 * "Ремонти": a board with one column per stage (the stage list is data from GET /jobs/config)
 * or a flat list, with filters. Technicians see the jobs assigned to them.
 */
export function JobsPage() {
  const { t, locale, moneyFull, date } = useI18n()
  const { hasRole } = useAuth()
  const cfg = useJobsConfig()
  const [params, setParams] = useSearchParams()
  const view: View = params.get('view') === 'list' ? 'list' : 'board'
  const status = params.get('status') ?? ''
  const q = params.get('q') ?? ''
  const [buildingId, setBuildingId] = useState('')
  const [assignedUserId, setAssignedUserId] = useState('')
  const [kind, setKind] = useState<JobKind | ''>('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [buildings, setBuildings] = useState<BuildingDto[]>([])
  const [users, setUsers] = useState<UserDto[]>([])
  const canEdit = hasRole('owner', 'office')

  useEffect(() => {
    get<Page<BuildingDto>>('/buildings?limit=200')
      .then((p) => setBuildings(p.items))
      .catch(() => undefined)
    if (canEdit)
      get<{ items: UserDto[] }>('/users')
        .then((r) => setUsers(r.items.filter((u) => u.isActive)))
        .catch(() => undefined)
  }, [canEdit])

  const list = useCursorList<JobDto>(
    (cursor) =>
      get<Page<JobDto>>(
        `/jobs${qs({
          open: view === 'board' && !status ? 'true' : undefined,
          status: status || undefined,
          q,
          buildingId,
          assignedUserId,
          kind,
          from,
          to,
          cursor,
          limit: view === 'board' ? 200 : 50,
        })}`,
      ),
    [view, status, q, buildingId, assignedUserId, kind, from, to],
  )

  const setParam = (key: string, value: string) => {
    const p = new URLSearchParams(params)
    if (value) p.set(key, value)
    else p.delete(key)
    setParams(p)
  }

  const columns = useMemo(() => {
    if (!cfg) return []
    const byStage = new Map<string, JobDto[]>()
    for (const j of list.items) byStage.set(j.status, [...(byStage.get(j.status) ?? []), j])
    return cfg.stages
      .filter((s) => (status ? s.code === status : !s.isTerminal))
      .map((s) => ({ stage: s, items: byStage.get(s.code) ?? [] }))
  }, [cfg, list.items, status])

  return (
    <div>
      <PageHeader
        title={t('jobs.title')}
        subtitle={t('jobs.subtitle')}
        actions={
          canEdit ? (
            <Link className="btn btn-primary" to="/jobs/new">
              {t('jobs.new')}
            </Link>
          ) : null
        }
      />
      <div className="toolbar">
        <div className="seg" role="tablist">
          <button
            type="button"
            className={`btn btn-small${view === 'board' ? ' btn-primary' : ''}`}
            onClick={() => setParam('view', '')}
          >
            {t('jobs.board')}
          </button>
          <button
            type="button"
            className={`btn btn-small${view === 'list' ? ' btn-primary' : ''}`}
            onClick={() => setParam('view', 'list')}
          >
            {t('jobs.list')}
          </button>
        </div>
        <SearchBox value={q} onChange={(v) => setParam('q', v)} placeholder={t('jobs.search')} />
        <select
          value={status}
          onChange={(e) => setParam('status', e.target.value)}
          aria-label={t('jobs.stage')}
        >
          <option value="">{view === 'board' ? t('jobs.allOpen') : t('jobs.allStages')}</option>
          {(cfg?.stages ?? []).map((s) => (
            <option key={s.code} value={s.code}>
              {locale === 'en' ? s.label.en : s.label.bg}
            </option>
          ))}
        </select>
        <select
          value={buildingId}
          onChange={(e) => setBuildingId(e.target.value)}
          aria-label={t('buildings.one')}
        >
          <option value="">{t('payments.allBuildings')}</option>
          {buildings.map((b) => (
            <option key={b.id} value={b.id}>
              {b.addressText}
            </option>
          ))}
        </select>
        {canEdit ? (
          <select
            value={assignedUserId}
            onChange={(e) => setAssignedUserId(e.target.value)}
            aria-label={t('jobs.assigned')}
          >
            <option value="">{t('jobs.anyTechnician')}</option>
            {users
              .filter((u) => u.role === 'technician')
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
          </select>
        ) : null}
        <EnumSelect
          value={kind}
          options={JobKindEnum.options}
          prefix="enum.jobKind"
          onChange={setKind}
          allowEmpty
          emptyLabel={t('jobs.allKinds')}
        />
        <Field label={t('callbacks.from')}>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label={t('callbacks.to')}>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>
      <ErrorBox error={list.error} />
      {list.loading && list.items.length === 0 ? (
        <Spinner />
      ) : view === 'list' ? (
        <div className="card">
          <JobList items={list.items} stages={cfg?.stages} />
          <LoadMore hasMore={list.hasMore} loading={list.loading} onClick={list.loadMore} />
        </div>
      ) : (
        <div className="job-board">
          {columns.map(({ stage, items }) => (
            <div key={stage.code} className="job-col">
              <div className="job-col-head">
                <Badge kind={stageBadge(stage.code)}>
                  {stageLabel(cfg?.stages, stage.code, locale, t)}
                </Badge>
                <span className="muted small">
                  {items.length}
                  {items.length
                    ? ` · ${moneyFull(items.reduce((s, j) => s + j.totalCents, 0))}`
                    : ''}
                </span>
              </div>
              {items.length === 0 ? (
                <div className="job-col-empty muted small">{t('jobs.columnEmpty')}</div>
              ) : (
                items.map((j) => (
                  <Link key={j.id} to={`/jobs/${j.id}`} className="job-card">
                    <div className="job-card-title">{j.title}</div>
                    <div className="small">{j.buildingAddressText}</div>
                    <div className="small muted">
                      {j.elevatorInternalNo} · {moneyFull(j.totalCents)}
                    </div>
                    <div className="small muted">
                      {j.scheduledAt
                        ? `${t('jobs.scheduledAt')}: ${date(j.scheduledAt)}`
                        : j.quoteSentAt
                          ? `${t('jobs.sentAt')}: ${date(j.quoteSentAt)}`
                          : `${t('jobs.createdAt')}: ${date(j.createdAt)}`}
                      {j.assignedUserNames.length ? ` · ${j.assignedUserNames.join(', ')}` : ''}
                    </div>
                    {j.status === 'done' && j.netCents - j.invoicedCents > 0 ? (
                      <Badge kind="danger">{t('jobs.notInvoiced')}</Badge>
                    ) : null}
                  </Link>
                ))
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
