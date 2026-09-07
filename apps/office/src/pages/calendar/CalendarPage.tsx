import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import type { CalendarDto, CalendarItemDto, CalendarItemKind } from '@avroleva/contracts'
import { CalendarItemKind as CalendarItemKindEnum } from '@avroleva/contracts'
import { get, qs } from '../../lib/api'
import { addDays, todaySofia } from '../../lib/dates'
import { useI18n } from '../../i18n/I18nProvider'
import { useAuth } from '../../auth/AuthProvider'
import { Badge, Empty, ErrorBox, PageHeader, Spinner } from '../../components/ui'
import { InspectionForm } from '../../components/inspections/InspectionForm'
import { ElevatorPanel } from '../../components/ElevatorPanel'

type Group = 'overdue' | 'thisWeek' | 'thisMonth' | 'later'
const WINDOWS = [30, 90, 365] as const

export function kindBadge(kind: CalendarItemKind): 'ok' | 'warn' | 'danger' | 'muted' | 'info' {
  switch (kind) {
    case 'callback_sla':
      return 'danger'
    case 'check_overdue':
      return 'warn'
    case 'defect_follow_up':
      return 'warn'
    case 'inspection_due':
      return 'info'
    default:
      return 'muted'
  }
}

function groupOf(item: CalendarItemDto, today: string): Group {
  if (item.dueAt < today) return 'overdue'
  if (item.dueAt <= addDays(today, 7)) return 'thisWeek'
  if (item.dueAt.slice(0, 7) === today.slice(0, 7)) return 'thisMonth'
  return 'later'
}

/** "Календар": every deadline in one list, grouped overdue / this week / this month / later. */
export function CalendarPage() {
  const { t, date } = useI18n()
  const { hasRole } = useAuth()
  const [days, setDays] = useState<(typeof WINDOWS)[number]>(90)
  const [kinds, setKinds] = useState<Set<CalendarItemKind>>(new Set(CalendarItemKindEnum.options))
  const [data, setData] = useState<CalendarDto | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [version, setVersion] = useState(0)
  const [adding, setAdding] = useState(false)
  const [panelId, setPanelId] = useState<string | null>(null)
  const today = todaySofia()

  useEffect(() => {
    let cancelled = false
    get<CalendarDto>(`/calendar${qs({ from: today, to: addDays(today, days) })}`)
      .then((d) => {
        if (cancelled) return
        setData(d)
        setError(null)
      })
      .catch((e) => !cancelled && setError(e))
    return () => {
      cancelled = true
    }
  }, [days, version, today])

  const toggle = (k: CalendarItemKind) =>
    setKinds((s) => {
      const n = new Set(s)
      if (n.has(k)) n.delete(k)
      else n.add(k)
      return n
    })

  const items = (data?.items ?? []).filter((i) => kinds.has(i.kind))
  const groups: Record<Group, CalendarItemDto[]> = {
    overdue: [],
    thisWeek: [],
    thisMonth: [],
    later: [],
  }
  for (const it of items) groups[groupOf(it, today)].push(it)
  const labels: Record<Group, string> = {
    overdue: t('calendar.overdue'),
    thisWeek: t('calendar.thisWeek'),
    thisMonth: t('calendar.thisMonth'),
    later: t('calendar.later'),
  }

  return (
    <div>
      <PageHeader
        title={t('calendar.title')}
        subtitle={t('calendar.subtitle')}
        actions={
          hasRole('owner', 'office') ? (
            <button type="button" className="btn btn-primary" onClick={() => setAdding((v) => !v)}>
              {t('inspections.new')}
            </button>
          ) : null
        }
      />
      {adding ? (
        <div className="card narrow">
          <h2>{t('inspections.new')}</h2>
          <InspectionForm
            onDone={() => {
              setAdding(false)
              setVersion((v) => v + 1)
            }}
            onCancel={() => setAdding(false)}
          />
        </div>
      ) : null}
      <div className="toolbar cal-toolbar">
        <div className="seg" role="tablist">
          {WINDOWS.map((w) => (
            <button
              key={w}
              type="button"
              role="tab"
              aria-selected={days === w}
              className={days === w ? 'active' : ''}
              onClick={() => setDays(w)}
            >
              {t(`calendar.window${w}`)}
            </button>
          ))}
        </div>
        <div className="check-list cal-filters">
          {CalendarItemKindEnum.options.map((k) => (
            <label key={k} className="check">
              <input type="checkbox" checked={kinds.has(k)} onChange={() => toggle(k)} />
              <span>{t(`enum.calendarKind.${k}`)}</span>
              {data ? <b className="muted">{data.counts[k]}</b> : null}
            </label>
          ))}
        </div>
      </div>
      <ErrorBox error={error} />
      {!data ? (
        <Spinner />
      ) : items.length === 0 ? (
        <div className="card">
          <Empty text={t('calendar.empty')} />
        </div>
      ) : (
        (Object.keys(groups) as Group[]).map((g) =>
          groups[g].length === 0 ? null : (
            <div key={g} className="card">
              <h2 className={g === 'overdue' ? 'text-danger' : ''}>
                {labels[g]} <span className="muted small">{groups[g].length}</span>
              </h2>
              <ul className="list cal-list">
                {groups[g].map((it) => (
                  <li key={it.id} className={`cal-row cal-${it.severity}`}>
                    <div className="cal-date">
                      <strong>{date(it.dueAt)}</strong>
                      <div className="small muted">
                        {it.inDays === 0
                          ? t('calendar.today')
                          : it.inDays < 0
                            ? t('calendar.overdueBy', { count: -it.inDays })
                            : t('calendar.inDays', { count: it.inDays })}
                      </div>
                    </div>
                    <div className="cb-main">
                      <div className="cb-head">
                        <Badge kind={kindBadge(it.kind)}>{t(`enum.calendarKind.${it.kind}`)}</Badge>
                        <span>{it.title}</span>
                      </div>
                      <div className="small">
                        <button
                          type="button"
                          className="linkish"
                          onClick={() => setPanelId(it.elevatorId)}
                        >
                          <strong>{it.elevatorInternalNo}</strong>
                        </button>
                        {' · '}
                        <Link to={`/buildings/${it.buildingId}`}>{it.buildingAddressText}</Link>
                      </div>
                    </div>
                    <div className="actions">
                      {it.kind === 'callback_sla' ? (
                        <Link className="btn btn-small" to="/callbacks">
                          {t('callbacks.title')}
                        </Link>
                      ) : it.kind === 'defect_follow_up' ? (
                        <Link className="btn btn-small" to="/defects?tab=followUp">
                          {t('defects.title')}
                        </Link>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-small"
                          onClick={() => setPanelId(it.elevatorId)}
                        >
                          {t('dashboard.open')}
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ),
        )
      )}
      {panelId ? (
        <ElevatorPanel
          elevatorId={panelId}
          onClose={() => setPanelId(null)}
          onChanged={() => setVersion((v) => v + 1)}
        />
      ) : null}
    </div>
  )
}
