import { useMemo } from 'react'
import { Link } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { CHECK_VISIT_KINDS } from '@avroleva/contracts'
import type { PlanStopDto, SyncJobDto } from '@avroleva/contracts'
import { useApp } from '../app/AppProvider'
import { useToast } from '../components/Toast'
import { Empty, PageHeader, Section, Spinner, TelLink } from '../components/ui'
import type { BuildingRow, ContactRow, DayPlanRow, ElevatorRow, RepairJobRow } from '../db'
import { db } from '../db'
import { useI18n } from '../i18n/I18nProvider'
import { addDays, todayInSofia } from '../lib/dates'
import { navigationUrl } from '../lib/maps'
import type { StopOutcome } from '../lib/plans'
import { orderedStops, stopRoute } from '../lib/plans'
import { markPlanStop } from '../sync'

const STATES: Array<{ key: SyncJobDto['state']; label: string; tone?: 'danger' }> = [
  { key: 'overdue', label: 'tech.today.overdue', tone: 'danger' },
  { key: 'today', label: 'tech.today.today' },
  { key: 'tomorrow', label: 'tech.today.tomorrow' },
]

const STOP_TONE: Record<PlanStopDto['kind'], 'ok' | 'warn' | 'danger' | 'muted'> = {
  check: 'ok',
  callback: 'danger',
  job: 'warn',
  inspection: 'muted',
}

interface BuildingGroup {
  building: BuildingRow
  contact: ContactRow | undefined
  rows: Array<{ job: SyncJobDto; elevator: ElevatorRow }>
}

export function houseManager(contacts: ContactRow[]): ContactRow | undefined {
  const managers = contacts.filter((c) => c.role === 'house_manager')
  return (
    managers.find((c) => c.isPrimary && c.phone) ??
    managers.find((c) => c.phone) ??
    managers[0] ??
    contacts.find((c) => c.isPrimary && c.phone) ??
    contacts.find((c) => c.phone)
  )
}

/** addressText usually already ends with the entrance; append it only when it does not. */
export function buildingTitle(b: BuildingRow, entranceShort: string): string {
  if (!b.entrance) return b.addressText
  const suffix = `${entranceShort} ${b.entrance}`.toLowerCase()
  if (b.addressText.toLowerCase().includes(suffix)) return b.addressText
  return `${b.addressText}, ${suffix}`
}

function BuildingCard({ group }: { group: BuildingGroup }) {
  const { t } = useI18n()
  const pendingIds = usePendingCheckIds()
  const { building, contact, rows } = group
  return (
    <div className="card">
      <div className="card-title">{buildingTitle(building, t('address.entranceShort'))}</div>
      {building.customerName ? <div className="muted small">{building.customerName}</div> : null}
      {contact ? (
        <div className="small">
          <span className="muted">{`${t('enum.contactRole.house_manager')}: `}</span>
          {contact.name}
        </div>
      ) : null}
      <div className="card-actions">
        <TelLink phone={contact?.phone} />
        {building.lat != null && building.lng != null ? (
          <a
            className="btn btn-outline"
            href={navigationUrl(building.lat, building.lng)}
            target="_blank"
            rel="noreferrer"
          >
            {t('tech.today.navigate')}
          </a>
        ) : null}
      </div>
      <div className="list">
        {rows.map(({ job, elevator }) => (
          <Link key={elevator.id} className="row" to={`/elevators/${elevator.id}`}>
            <div className="row-main">
              <span className="row-title">{elevator.internalNo}</span>
              <span className="row-sub">
                {elevator.regNo ? `${t('elevators.regNo')} ${elevator.regNo}` : ''}
                {job.state === 'overdue'
                  ? `${elevator.regNo ? ' · ' : ''}${t('tech.today.daysOverdue', { count: job.daysOverdue })}`
                  : ''}
              </span>
            </div>
            {pendingIds.has(elevator.id) ? (
              <span className="pill pill-ok">{t('tech.elevator.pendingLocal')}</span>
            ) : null}
            <span className="row-chevron" aria-hidden="true">
              ›
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
}

/** Elevators with a check visit recorded on this phone that the server has not confirmed yet. */
function usePendingCheckIds(): Set<string> {
  const local = useLiveQuery(() => db.visits.filter((v) => v.local === true).toArray(), [])
  return useMemo(
    () =>
      new Set(
        (local ?? []).filter((v) => CHECK_VISIT_KINDS.includes(v.kind)).map((v) => v.elevatorId),
      ),
    [local],
  )
}

/** Repair jobs assigned to me (step 8): scheduled / in progress, soonest first. */
function RepairJobs({ jobs }: { jobs: RepairJobRow[] }) {
  const { t, dateTime } = useI18n()
  if (jobs.length === 0) return null
  return (
    <Section title={t('tech.jobs.section', { count: jobs.length })}>
      <div className="list">
        {jobs.map((j) => (
          <Link key={j.id} className="row" to={`/jobs/${j.id}`}>
            <div className="row-main">
              <span className="row-title">{j.title}</span>
              <span className="row-sub">
                {j.buildingAddressText} · {j.elevatorInternalNo}
                {j.scheduledAt ? ` · ${dateTime(j.scheduledAt)}` : ''}
              </span>
            </div>
            <span
              className={`pill ${j.local === 'done' ? 'pill-ok' : j.status === 'in_progress' ? 'pill-warn' : 'pill-muted'}`}
            >
              {j.local === 'done' ? t('tech.jobs.completedLocal') : t(`enum.jobStage.${j.status}`)}
            </span>
            <span className="row-chevron" aria-hidden="true">
              ›
            </span>
          </Link>
        ))}
      </div>
    </Section>
  )
}

/**
 * One stop of the day plan (step 9): sequence number, the office's label, where, ETA, the kind;
 * a tap opens the screen for that kind of work; "Готово" / "Пропусни" queue a `plan.stop` item.
 */
function PlanStopRow({
  stop,
  seq,
  readOnly,
  onMark,
}: {
  stop: PlanStopDto
  seq: number
  readOnly: boolean
  onMark: (stop: PlanStopDto, status: StopOutcome) => void
}) {
  const { t, time } = useI18n()
  const done = stop.status === 'done'
  const skipped = stop.status === 'skipped'
  return (
    <div className={`plan-stop${done ? ' is-done' : skipped ? ' is-skipped' : ''}`}>
      <Link className="plan-stop-main" to={stopRoute(stop)}>
        <span className="plan-seq" aria-hidden="true">
          {done ? '✓' : seq}
        </span>
        <div className="row-main">
          <span className="row-title">{stop.label}</span>
          <span className="row-sub">
            {`${stop.buildingAddressText} · ${stop.elevatorInternalNo}`}
            {stop.eta ? ` · ${t('tech.plan.eta', { at: time(stop.eta) })}` : ''}
          </span>
        </div>
        <span className={`pill pill-${STOP_TONE[stop.kind]}`}>
          {t(`enum.planStopKind.${stop.kind}`)}
        </span>
      </Link>
      <div className="plan-stop-actions">
        {stop.lat != null && stop.lng != null ? (
          <a
            className="btn btn-sm btn-outline"
            href={navigationUrl(stop.lat, stop.lng)}
            target="_blank"
            rel="noreferrer"
          >
            {t('tech.today.navigate')}
          </a>
        ) : null}
        <TelLink phone={stop.contact?.phone} small />
        {skipped ? <span className="pill pill-muted">{t('tech.plan.skipped')}</span> : null}
        {!readOnly && !done ? (
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() => onMark(stop, 'done')}
          >
            {t('tech.plan.done')}
          </button>
        ) : null}
        {!readOnly && !done && !skipped ? (
          <button type="button" className="btn btn-sm" onClick={() => onMark(stop, 'skipped')}>
            {t('tech.plan.skip')}
          </button>
        ) : null}
      </div>
    </div>
  )
}

/** My published plan for the day: header with totals, then the stops in the planned order. */
function PlanCard({ plan, tomorrow }: { plan: DayPlanRow; tomorrow?: boolean }) {
  const { t, locale } = useI18n()
  const toast = useToast()
  const stops = orderedStops(plan)
  const done = stops.filter((s) => s.status === 'done').length
  const km = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(plan.totals.estKm)
  const title = `${tomorrow ? t('tech.plan.tomorrow') : t('tech.plan.title')} · ${t('tech.plan.totals', { count: stops.length, km })}`
  const onMark = (stop: PlanStopDto, status: StopOutcome) => {
    void markPlanStop(plan.id, stop.id, status).then((changed) => {
      if (changed) toast.show(t('tech.plan.saved'))
    })
  }
  return (
    <Section title={title}>
      <div className="card">
        <div className="plan-head">
          <span>{plan.pairName ?? plan.userNames.join(', ')}</span>
          <span>{t('tech.plan.progress', { done, total: stops.length })}</span>
        </div>
        {plan.notes ? <p className="small muted pre">{plan.notes}</p> : null}
        <div className="list">
          {stops.map((s, i) => (
            <PlanStopRow key={s.id} stop={s} seq={i + 1} readOnly={!!tomorrow} onMark={onMark} />
          ))}
        </div>
      </div>
    </Section>
  )
}

export function TodayPage() {
  const { t, dateTime } = useI18n()
  const app = useApp()
  const today = todayInSofia()
  const jobs = useLiveQuery(() => db.jobs.toArray(), [])
  const repairJobs = useLiveQuery(
    () =>
      db.repairJobs
        .toArray()
        .then((rows) =>
          rows.sort((a, b) => (a.scheduledAt ?? '9').localeCompare(b.scheduledAt ?? '9')),
        ),
    [],
    [] as RepairJobRow[],
  )
  const plans = useLiveQuery(() => db.dayPlans.toArray(), [], [] as DayPlanRow[])
  const buildings = useLiveQuery(() => db.buildings.toArray(), [])
  const elevators = useLiveQuery(() => db.elevators.toArray(), [])
  const contacts = useLiveQuery(() => db.contacts.toArray(), [])

  // Step 9: the office's plan comes first; tomorrow's shows only while today has none.
  const todayPlans = useMemo(() => plans.filter((p) => p.date === today), [plans, today])
  const tomorrowPlans = useMemo(
    () => (todayPlans.length ? [] : plans.filter((p) => p.date === addDays(today, 1))),
    [plans, todayPlans.length, today],
  )
  const planned = useMemo(() => {
    const elevatorIds = new Set<string>()
    const jobIds = new Set<string>()
    for (const p of todayPlans)
      for (const s of p.stops) {
        elevatorIds.add(s.elevatorId)
        if (s.kind === 'job') jobIds.add(s.refId)
      }
    return { elevatorIds, jobIds }
  }, [todayPlans])

  // Due lifts not already covered by a stop of today's plan.
  const groups = useMemo(() => {
    const out = new Map<SyncJobDto['state'], BuildingGroup[]>()
    if (!jobs || !buildings || !elevators || !contacts) return out
    const bById = new Map(buildings.map((b) => [b.id, b]))
    const eById = new Map(elevators.map((e) => [e.id, e]))
    const contactsByBuilding = new Map<string, ContactRow[]>()
    for (const c of contacts) {
      if (!c.buildingId) continue
      const list = contactsByBuilding.get(c.buildingId) ?? []
      list.push(c)
      contactsByBuilding.set(c.buildingId, list)
    }
    for (const s of STATES) {
      const byBuilding = new Map<string, BuildingGroup>()
      for (const job of jobs) {
        if (job.state !== s.key) continue
        if (planned.elevatorIds.has(job.elevatorId)) continue
        const elevator = eById.get(job.elevatorId)
        const building = bById.get(job.buildingId)
        if (!elevator || !building) continue
        let g = byBuilding.get(building.id)
        if (!g) {
          g = {
            building,
            contact: houseManager(contactsByBuilding.get(building.id) ?? []),
            rows: [],
          }
          byBuilding.set(building.id, g)
        }
        g.rows.push({ job, elevator })
      }
      const list = [...byBuilding.values()]
      list.sort((a, b) => a.building.addressText.localeCompare(b.building.addressText, 'bg'))
      for (const g of list)
        g.rows.sort((a, b) => a.elevator.internalNo.localeCompare(b.elevator.internalNo, 'bg'))
      out.set(s.key, list)
    }
    return out
  }, [jobs, buildings, elevators, contacts, planned])
  const otherJobs = useMemo(
    () => repairJobs.filter((j) => !planned.jobIds.has(j.id)),
    [repairJobs, planned],
  )

  const loaded = jobs && buildings && elevators && contacts
  const neverPulled = !app.meta.watermark
  const total = (jobs?.length ?? 0) + repairJobs.length + todayPlans.length + tomorrowPlans.length
  const dueCount = [...groups.values()].reduce(
    (n, list) => n + list.reduce((m, g) => m + g.rows.length, 0),
    0,
  )

  const dueSections = STATES.map((s) => {
    const list = groups.get(s.key) ?? []
    if (!list.length) return null
    const count = list.reduce((n, g) => n + g.rows.length, 0)
    return (
      <Section key={s.key} title={`${t(s.label)} · ${t('tech.today.elevators', { count })}`}>
        {list.map((g) => (
          <BuildingCard key={g.building.id} group={g} />
        ))}
      </Section>
    )
  })

  return (
    <>
      <PageHeader
        title={t('tech.today.title')}
        subtitle={
          <>
            {t('tech.today.lastSync', {
              at: app.meta.lastPullAt ? dateTime(app.meta.lastPullAt) : t('tech.today.never'),
            })}
            {app.pullError ? (
              <span className="danger">{` · ${t('tech.outbox.error')}: ${app.pullError}`}</span>
            ) : null}
          </>
        }
        right={
          <button
            type="button"
            className="btn btn-sm btn-outline"
            disabled={app.pulling}
            onClick={() => void app.syncNow()}
          >
            {app.pulling ? <Spinner inline /> : null}
            {app.pulling ? t('tech.today.syncing') : t('tech.today.sync')}
          </button>
        }
      />
      <div className="page">
        {!loaded ? (
          <Spinner />
        ) : neverPulled && total === 0 ? (
          <Empty text={t('tech.today.notSynced')} />
        ) : total === 0 ? (
          <Empty text={t('tech.today.empty')} />
        ) : (
          <>
            {todayPlans.map((p) => (
              <PlanCard key={p.id} plan={p} />
            ))}
            <RepairJobs jobs={otherJobs} />
            {todayPlans.length === 0 ? (
              dueSections
            ) : dueCount > 0 ? (
              <details className="plan-others">
                <summary>
                  {`${t('tech.plan.others')} · ${t('tech.today.elevators', { count: dueCount })}`}
                </summary>
                <div className="stack">{dueSections}</div>
              </details>
            ) : null}
            {tomorrowPlans.map((p) => (
              <PlanCard key={p.id} plan={p} tomorrow />
            ))}
          </>
        )}
      </div>
    </>
  )
}
