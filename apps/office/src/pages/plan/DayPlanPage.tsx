import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import type {
  DayBoardDto,
  DayPlanDto,
  GenerateDayPlansResultDto,
  MoveStopResultDto,
  PlanStopStatus,
  PublishDayPlansResultDto,
  UnplannedStopDto,
  ZoneDto,
} from '@avroleva/contracts'
import { ApiError, get, patch, post, qs } from '../../lib/api'
import { todaySofia } from '../../lib/dates'
import { useI18n } from '../../i18n/I18nProvider'
import { useAuth } from '../../auth/AuthProvider'
import { Empty, ErrorBox, Field, PageHeader, Spinner, toast } from '../../components/ui'
import { PlanBoard } from './PlanBoard'
import { PlanMap } from './PlanMap'
import {
  defaultPlanDate,
  moveIndex,
  renumber,
  toStopInputs,
  unplannedKey,
  unplannedToInput,
  withPlans,
} from './planUtils'

/**
 * "План за деня": the day's plans (one column per pair) beside a map, generated from what is
 * due and rearranged by drag and drop; publishing sends them to the technicians' phones.
 * Owner / office edit; technicians see the board read-only. Every mutation replaces the plans
 * from the API response (no full reload) except removing a stop, which also refreshes the
 * unplanned list the server keeps.
 */
export function DayPlanPage() {
  const { t, number } = useI18n()
  const { hasRole } = useAuth()
  const canEdit = hasRole('owner', 'office')
  const [params, setParams] = useSearchParams()
  const [fallbackDate] = useState(defaultPlanDate)
  const date = params.get('date') || fallbackDate
  const zoneId = params.get('zoneId') ?? ''
  const [zones, setZones] = useState<ZoneDto[]>([])
  const [board, setBoard] = useState<DayBoardDto | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [version, setVersion] = useState(0)
  const [busy, setBusy] = useState<'generate' | 'publish' | null>(null)
  const [highlight, setHighlight] = useState<string | null>(null)
  const isPast = date < todaySofia()

  useEffect(() => {
    get<{ items: ZoneDto[] }>('/zones')
      .then((r) => setZones(r.items.filter((z) => z.active)))
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    get<DayBoardDto>(`/day-plans${qs({ date, zoneId })}`)
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
  }, [date, zoneId, version])

  useEffect(() => {
    if (!highlight) return
    const h = setTimeout(() => setHighlight(null), 2500)
    return () => clearTimeout(h)
  }, [highlight])

  const setParam = (key: string, value: string) => {
    const p = new URLSearchParams(params)
    if (value) p.set(key, value)
    else p.delete(key)
    setParams(p)
  }
  const reload = () => setVersion((v) => v + 1)
  const fail = (e: unknown) =>
    toast(e instanceof ApiError ? e.problem.title : t('error.internal'), 'error')

  /** Replace these plans in the board (optimistic or from a response) and recompute the totals. */
  const replacePlans = (updated: DayPlanDto[]) =>
    setBoard((b) => {
      if (!b) return b
      const byId = new Map(updated.map((u) => [u.id, u]))
      return withPlans(
        b,
        b.plans.map((p) => byId.get(p.id) ?? p),
      )
    })

  const pick = useCallback((id: string) => {
    setHighlight(id)
    const el = document.querySelector(`[data-stop-id="${CSS.escape(id)}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
  }, [])

  const generate = async () => {
    setBusy('generate')
    try {
      const r = await post<GenerateDayPlansResultDto>('/day-plans/generate', {
        date,
        zoneId: zoneId || null,
      })
      setBoard(r.board)
      setError(null)
      toast(
        t('dayPlan.generated', {
          created: r.created,
          regenerated: r.regenerated,
          keptLocked: r.keptLocked,
        }),
      )
    } catch (e) {
      fail(e)
    } finally {
      setBusy(null)
    }
  }

  const publish = async () => {
    setBusy('publish')
    try {
      const r = await post<PublishDayPlansResultDto>('/day-plans/publish', {
        date,
        zoneId: zoneId || null,
      })
      setBoard(r.board)
      setError(null)
      toast(t('dayPlan.publishedToast', { count: r.published }))
    } catch (e) {
      fail(e)
    } finally {
      setBusy(null)
    }
  }

  const toggleLock = async (plan: DayPlanDto) => {
    try {
      replacePlans([
        await post<DayPlanDto>(`/day-plans/${plan.id}/${plan.locked ? 'unlock' : 'lock'}`),
      ])
    } catch (e) {
      fail(e)
    }
  }

  const setStatus = async (plan: DayPlanDto, stopId: string, status: PlanStopStatus) => {
    try {
      replacePlans([
        await post<DayPlanDto>(`/day-plans/${plan.id}/stops/${stopId}/status`, { status }),
      ])
    } catch (e) {
      fail(e)
    }
  }

  const reorder = async (plan: DayPlanDto, stopId: string, to: number) => {
    const from = plan.stops.findIndex((s) => s.id === stopId)
    if (from < 0 || to < 0 || to >= plan.stops.length || from === to) return
    const stops = renumber(moveIndex(plan.stops, from, to))
    replacePlans([{ ...plan, stops }])
    try {
      replacePlans([
        await patch<DayPlanDto>(`/day-plans/${plan.id}`, { stops: toStopInputs(stops) }),
      ])
    } catch (e) {
      fail(e)
      reload()
    }
  }

  const move = async (source: DayPlanDto, stopId: string, target: DayPlanDto, order: number) => {
    const stop = source.stops.find((s) => s.id === stopId)
    if (!stop) return
    const targetStops = [...target.stops]
    targetStops.splice(Math.min(order, targetStops.length), 0, { ...stop, manual: true })
    replacePlans([
      { ...source, stops: renumber(source.stops.filter((s) => s.id !== stopId)) },
      { ...target, stops: renumber(targetStops) },
    ])
    try {
      const r = await post<MoveStopResultDto>(`/day-plans/${source.id}/move-stop`, {
        stopId,
        toPlanId: target.id,
        order,
      })
      replacePlans([r.from, r.to])
    } catch (e) {
      fail(e)
      reload()
    }
  }

  const add = async (item: UnplannedStopDto, target: DayPlanDto, order?: number) => {
    const inputs = toStopInputs(target.stops)
    inputs.splice(
      order === undefined ? inputs.length : Math.min(order, inputs.length),
      0,
      unplannedToInput(item),
    )
    try {
      const updated = await patch<DayPlanDto>(`/day-plans/${target.id}`, {
        stops: inputs.map((s, i) => ({ ...s, order: i })),
      })
      const key = unplannedKey(item)
      setBoard((b) =>
        b
          ? withPlans(
              { ...b, unplanned: b.unplanned.filter((u) => unplannedKey(u) !== key) },
              b.plans.map((p) => (p.id === updated.id ? updated : p)),
            )
          : b,
      )
    } catch (e) {
      fail(e)
    }
  }

  const remove = async (plan: DayPlanDto, stopId: string) => {
    const stops = renumber(plan.stops.filter((s) => s.id !== stopId))
    replacePlans([{ ...plan, stops }])
    try {
      replacePlans([
        await patch<DayPlanDto>(`/day-plans/${plan.id}`, { stops: toStopInputs(stops) }),
      ])
    } catch (e) {
      fail(e)
    }
    // The removed stop is due again: the unplanned list lives on the server.
    reload()
  }

  const drafts = board?.plans.filter((p) => p.status === 'draft').length ?? 0
  const hasColumns = !!board && (board.plans.length > 0 || board.unplanned.length > 0)

  return (
    <div className="plan-page">
      <PageHeader title={t('dayPlan.title')} subtitle={t('dayPlan.subtitle')} />
      <div className="toolbar plan-toolbar">
        <Field label={t('dayPlan.date')}>
          <input type="date" value={date} onChange={(e) => setParam('date', e.target.value)} />
        </Field>
        <Field label={t('dayPlan.zone')}>
          <select value={zoneId} onChange={(e) => setParam('zoneId', e.target.value)}>
            <option value="">{t('dayPlan.allZones')}</option>
            {zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="actions plan-toolbar-actions">
          {canEdit ? (
            <>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy !== null || isPast}
                title={isPast ? t('dayPlan.pastDate') : undefined}
                onClick={generate}
              >
                {t('dayPlan.generate')}
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy !== null || drafts === 0}
                title={t('dayPlan.sent')}
                onClick={publish}
              >
                {t('dayPlan.publish')}
              </button>
            </>
          ) : (
            <span className="muted small">{t('dayPlan.readOnly')}</span>
          )}
          <button type="button" className="btn" disabled={loading} onClick={reload}>
            {t('dayPlan.refresh')}
          </button>
        </div>
      </div>
      <ErrorBox error={error} />
      {!board ? (
        loading ? (
          <Spinner />
        ) : null
      ) : (
        <div className={loading ? 'is-loading' : ''}>
          <div className="plan-totals">
            <span>{t('dayPlan.stops', { count: board.totals.stops })}</span>
            <span>{t('dayPlan.elevators', { count: board.totals.elevators })}</span>
            <span>
              {t('dayPlan.estKm', {
                km: number(board.totals.estKm, { maximumFractionDigits: 1 }),
              })}
            </span>
            <span>{t('dayPlan.plansCount', { count: board.totals.plans })}</span>
            <span>
              {t('dayPlan.publishedOf', {
                published: board.totals.published,
                plans: board.totals.plans,
              })}
            </span>
          </div>
          <div className="plan-layout">
            <div className="plan-board-wrap">
              {board.plans.length === 0 ? <Empty text={t('dayPlan.empty')} /> : null}
              {hasColumns ? (
                <PlanBoard
                  board={board}
                  zones={zones}
                  canEdit={canEdit}
                  highlight={highlight}
                  onReorder={reorder}
                  onMove={move}
                  onAdd={add}
                  onRemove={remove}
                  onStatus={setStatus}
                  onToggleLock={toggleLock}
                />
              ) : null}
            </div>
            <div className="plan-map-wrap">
              <PlanMap
                plans={board.plans}
                unplanned={board.unplanned}
                fitKey={`${board.date}|${board.zoneId ?? ''}`}
                onPick={pick}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
