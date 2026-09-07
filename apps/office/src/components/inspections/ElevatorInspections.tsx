import { useEffect, useState } from 'react'
import type { AlarmTestDto, ElevatorDto, InspectionDto, Page } from '@avroleva/contracts'
import { ApiError, BASE, get, post, qs } from '../../lib/api'
import { useI18n } from '../../i18n/I18nProvider'
import { useAuth } from '../../auth/AuthProvider'
import { Badge, Empty, ErrorBox, LoadMore, Spinner, toast, useCursorList } from '../ui'
import { InspectionForm } from './InspectionForm'

export function inspectionResultBadge(
  r: InspectionDto['result'],
): 'ok' | 'warn' | 'danger' | 'muted' {
  switch (r) {
    case 'passed':
      return 'ok'
    case 'passed_with_defects':
      return 'warn'
    case 'failed':
      return 'danger'
    default:
      return 'muted'
  }
}

/** Inspection rows (newest first) with inline edit for the office. */
export function InspectionList({
  items,
  onChanged,
  showElevator = true,
}: {
  items: InspectionDto[]
  onChanged: () => void
  showElevator?: boolean
}) {
  const { t, date } = useI18n()
  const { hasRole } = useAuth()
  const canEdit = hasRole('owner', 'office')
  const [editing, setEditing] = useState<string | null>(null)
  if (items.length === 0) return <Empty text={t('inspections.empty')} />
  return (
    <ul className="list insp-list">
      {items.map((i) => (
        <li key={i.id}>
          <div className="cb-head">
            <strong>
              {i.performedAt
                ? date(i.performedAt)
                : i.scheduledAt
                  ? `${t('inspections.scheduledAt')} ${date(i.scheduledAt)}`
                  : t('enum.inspectionResult.pending')}
            </strong>
            <Badge kind="muted">{t(`enum.inspectionKind.${i.kind}`)}</Badge>
            <Badge kind={inspectionResultBadge(i.result)}>
              {t(`enum.inspectionResult.${i.result}`)}
            </Badge>
            {i.nextDueAt ? (
              <span className="small muted">
                {t('inspections.nextDueAt')}: {date(i.nextDueAt)}
              </span>
            ) : null}
          </div>
          {showElevator ? (
            <div className="small">
              {i.elevatorInternalNo} · {i.buildingAddressText}
            </div>
          ) : null}
          {i.inspectionBody ? <div className="small muted">{i.inspectionBody}</div> : null}
          {i.defects.length > 0 ? (
            <ul className="small insp-defects">
              {i.defects.map((d, j) => (
                <li key={j} className={d.closed ? 'muted' : ''}>
                  {d.closed ? '✓ ' : '• '}
                  {d.text}
                  {d.deadline ? ` (${t('inspections.defectDeadline')}: ${date(d.deadline)})` : ''}
                </li>
              ))}
            </ul>
          ) : null}
          {i.notes ? <div className="small pre">{i.notes}</div> : null}
          {canEdit ? (
            <div className="actions">
              <button
                type="button"
                className="btn btn-small"
                onClick={() => setEditing(editing === i.id ? null : i.id)}
              >
                {t('common.edit')}
              </button>
            </div>
          ) : null}
          {editing === i.id ? (
            <div className="inset">
              <InspectionForm
                existing={i}
                onDone={() => {
                  setEditing(null)
                  onChanged()
                }}
                onCancel={() => setEditing(null)}
              />
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

/** The "Прегледи" tab of one elevator: inspections + alarm-device tests. */
export function ElevatorInspections({
  elevator,
  version,
  onChanged,
}: {
  elevator: ElevatorDto
  version: number
  onChanged: () => void
}) {
  const { t, dateTime } = useI18n()
  const { hasRole } = useAuth()
  const canEdit = hasRole('owner', 'office')
  const [adding, setAdding] = useState(false)
  const [tests, setTests] = useState<AlarmTestDto[] | null>(null)
  const [testBusy, setTestBusy] = useState(false)
  const [local, setLocal] = useState(0)
  const list = useCursorList<InspectionDto>(
    (cursor) =>
      get<Page<InspectionDto>>(`/elevators/${elevator.id}/inspections${qs({ cursor, limit: 20 })}`),
    [elevator.id, version, local],
  )
  useEffect(() => {
    let cancelled = false
    get<{ items: AlarmTestDto[] }>(`/elevators/${elevator.id}/alarm-tests`)
      .then((r) => !cancelled && setTests(r.items))
      .catch(() => !cancelled && setTests([]))
    return () => {
      cancelled = true
    }
  }, [elevator.id, version, local])

  const logTest = async (ok: boolean) => {
    setTestBusy(true)
    try {
      await post(`/elevators/${elevator.id}/alarm-tests`, { ok })
      toast(t('inspections.alarmTestLogged'))
      setLocal((v) => v + 1)
      onChanged()
    } catch (e) {
      toast(e instanceof ApiError ? e.problem.title : t('error.internal'), 'error')
    } finally {
      setTestBusy(false)
    }
  }

  return (
    <div>
      <div className="actions">
        {canEdit ? (
          <>
            <button
              type="button"
              className="btn btn-small btn-primary"
              onClick={() => setAdding((v) => !v)}
            >
              {t('inspections.new')}
            </button>
            <a
              className="btn btn-small"
              href={`${BASE}/print/inspection-request/${elevator.id}`}
              target="_blank"
              rel="noopener"
            >
              {t('inspections.printRequest')}
            </a>
          </>
        ) : null}
      </div>
      {adding ? (
        <div className="inset">
          <InspectionForm
            elevator={elevator}
            onDone={() => {
              setAdding(false)
              setLocal((v) => v + 1)
              onChanged()
            }}
            onCancel={() => setAdding(false)}
          />
        </div>
      ) : null}
      <ErrorBox error={list.error} />
      {list.loading && list.items.length === 0 ? (
        <Spinner />
      ) : (
        <InspectionList
          items={list.items}
          onChanged={() => setLocal((v) => v + 1)}
          showElevator={false}
        />
      )}
      <LoadMore hasMore={list.hasMore} loading={list.loading} onClick={list.loadMore} />
      <h3 className="sub-head">{t('inspections.alarmTests')}</h3>
      <div className="actions">
        <button
          type="button"
          className="btn btn-small"
          disabled={testBusy}
          onClick={() => logTest(true)}
        >
          {t('inspections.logAlarmTest')}: {t('inspections.alarmTestOk')}
        </button>
        <button
          type="button"
          className="btn btn-small btn-danger-outline"
          disabled={testBusy}
          onClick={() => logTest(false)}
        >
          {t('inspections.alarmTestFailed')}
        </button>
      </div>
      {tests === null ? (
        <Spinner />
      ) : tests.length === 0 ? (
        <p className="muted small">{t('inspections.noAlarmTests')}</p>
      ) : (
        <ul className="list compact">
          {tests.map((x) => (
            <li key={x.id}>
              <Badge kind={x.ok ? 'ok' : 'danger'}>
                {x.ok ? t('inspections.alarmTestOk') : t('inspections.alarmTestFailed')}
              </Badge>{' '}
              {dateTime(x.testedAt)}
              {x.byUserName ? <span className="muted"> · {x.byUserName}</span> : null}
              {x.notes ? <span className="muted"> · {x.notes}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
