import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import type { DueBoardDto, DueBuildingDto, DueElevatorDto } from '@avroleva/contracts'
import { ApiError, get, post, qs } from '../../lib/api'
import { todaySofia, tomorrowSofia } from '../../lib/dates'
import { useI18n } from '../../i18n/I18nProvider'
import { useAuth } from '../../auth/AuthProvider'
import { Badge, Empty, ErrorBox, Spinner, toast } from '../../components/ui'
import { RecordVisitForm } from '../../components/RecordVisitForm'
import { dueBadge, overrideBadge } from '../elevators/ElevatorsListPage'

type Day = 'today' | 'tomorrow'

/**
 * "Асансьори за поддръжка": overdue first, then what is due today (or tomorrow), grouped by
 * building with the house manager's phone. Recording a visit or rescheduling calls onChanged so
 * the dashboard (pins, counts) and this list refresh together.
 */
export function DueWidget({
  counts,
  version,
  onChanged,
  onOpen,
}: {
  counts: { overdue: number; today: number; tomorrow: number } | null
  version: number
  onChanged: () => void
  onOpen: (elevatorId: string) => void
}) {
  const { t, date } = useI18n()
  const { hasRole } = useAuth()
  const canReschedule = hasRole('owner', 'office')
  const [day, setDay] = useState<Day>('today')
  const [board, setBoard] = useState<DueBoardDto | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [recording, setRecording] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    get<DueBoardDto>(`/maintenance/due${qs({ date: day === 'tomorrow' ? tomorrowSofia() : null })}`)
      .then((b) => {
        if (cancelled) return
        setBoard(b)
        setError(null)
      })
      .catch((e) => !cancelled && setError(e))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [day, version])

  const reschedule = async (elevatorId: string, toDate: string | null) => {
    setBusyId(elevatorId)
    try {
      await post(`/elevators/${elevatorId}/reschedule`, { toDate })
      toast(t(toDate ? 'due.moved' : 'due.movedBack'))
      onChanged()
    } catch (e) {
      toast(e instanceof ApiError ? e.problem.title : t('error.internal'), 'error')
    } finally {
      setBusyId(null)
    }
  }

  const c = counts ?? board?.counts ?? null

  const renderElevator = (el: DueElevatorDto, overdue: boolean) => {
    const busy = busyId === el.elevatorId
    let move: { label: string; toDate: string | null } | null = null
    if (canReschedule) {
      if (overdue || day === 'today')
        move = { label: t('due.moveToTomorrow'), toDate: tomorrowSofia() }
      else if (el.nextCheckOverrideAt) move = { label: t('due.moveBack'), toDate: null }
    }
    return (
      <li key={el.elevatorId} className={`due-row${overdue ? ' due-row-overdue' : ''}`}>
        <div className="due-row-line">
          <div className="due-row-main">
            <strong>{el.internalNo}</strong>
            {el.regNo ? <span className="muted small"> · {el.regNo}</span> : null}{' '}
            {dueBadge(el.nextCheckDueAt, t, date)}
            {overrideBadge(el.nextCheckOverrideAt, t)}
          </div>
          <div className="actions">
            <button
              type="button"
              className="btn btn-small btn-primary"
              disabled={busy}
              onClick={() => setRecording(recording === el.elevatorId ? null : el.elevatorId)}
            >
              {t('visits.record')}
            </button>
            {move ? (
              <button
                type="button"
                className="btn btn-small"
                disabled={busy}
                onClick={() => reschedule(el.elevatorId, move.toDate)}
              >
                {move.label}
              </button>
            ) : null}
            <button type="button" className="btn btn-small" onClick={() => onOpen(el.elevatorId)}>
              {t('dashboard.open')}
            </button>
          </div>
        </div>
        {recording === el.elevatorId ? (
          <div className="inset">
            <RecordVisitForm
              elevatorId={el.elevatorId}
              onDone={() => {
                setRecording(null)
                onChanged()
              }}
              onCancel={() => setRecording(null)}
            />
          </div>
        ) : null}
      </li>
    )
  }

  const renderBuildings = (buildings: DueBuildingDto[], overdue: boolean) =>
    buildings.map((b) => (
      <li key={b.buildingId} className="due-building">
        <div className="due-building-head">
          <Link to={`/buildings/${b.buildingId}`}>{b.addressText}</Link>
          <div className="muted small">
            {b.customerName}
            {b.contact ? (
              <>
                {b.customerName ? ' · ' : ''}
                {b.contact.name}
                {b.contact.phone ? (
                  <>
                    {' '}
                    <a href={`tel:${b.contact.phone}`}>{b.contact.phone}</a>
                  </>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
        <ul className="list due-list">{b.elevators.map((el) => renderElevator(el, overdue))}</ul>
      </li>
    ))

  return (
    <div className="card due-widget">
      <div className="card-head">
        <h2>{t('due.title')}</h2>
        <div className="actions">
          {c ? (
            <div className="due-counts">
              <Badge kind="danger">{t('due.badgeOverdue', { count: c.overdue })}</Badge>
              <Badge kind="warn">{t('due.badgeToday', { count: c.today })}</Badge>
              <Badge kind="info">{t('due.badgeTomorrow', { count: c.tomorrow })}</Badge>
            </div>
          ) : null}
          {canReschedule ? (
            <Link
              className="btn btn-small"
              to={`/plan?date=${day === 'tomorrow' ? tomorrowSofia() : todaySofia()}`}
            >
              {t('dayPlan.planTheDay')}
            </Link>
          ) : null}
        </div>
      </div>
      <div className="seg" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={day === 'today'}
          className={day === 'today' ? 'active' : ''}
          onClick={() => setDay('today')}
        >
          {t('due.today')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={day === 'tomorrow'}
          className={day === 'tomorrow' ? 'active' : ''}
          onClick={() => setDay('tomorrow')}
        >
          {t('due.tomorrow')}
        </button>
      </div>
      <ErrorBox error={error} />
      {!board ? (
        loading ? (
          <Spinner />
        ) : null
      ) : board.overdue.length === 0 && board.due.length === 0 ? (
        <Empty text={t(day === 'today' ? 'due.emptyToday' : 'due.emptyTomorrow')} />
      ) : (
        <div className={loading ? 'is-loading' : ''}>
          {board.overdue.length > 0 ? (
            <section className="due-group">
              <h3 className="sub-head text-danger">{t('due.overdueGroup')}</h3>
              <ul className="list">{renderBuildings(board.overdue, true)}</ul>
            </section>
          ) : null}
          <section className="due-group">
            <h3 className="sub-head">{t(day === 'today' ? 'due.today' : 'due.tomorrow')}</h3>
            {board.due.length === 0 ? (
              <p className="muted small">
                {t(day === 'today' ? 'due.emptyToday' : 'due.emptyTomorrow')}
              </p>
            ) : (
              <ul className="list">{renderBuildings(board.due, false)}</ul>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
