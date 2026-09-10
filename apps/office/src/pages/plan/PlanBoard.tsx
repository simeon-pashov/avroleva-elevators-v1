import { useMemo, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import type {
  DayBoardDto,
  DayPlanDto,
  PlanStopStatus,
  UnplannedStopDto,
  ZoneDto,
} from '@avroleva/contracts'
import { useI18n } from '../../i18n/I18nProvider'
import { toast } from '../../components/ui'
import { PlanColumn } from './PlanColumn'
import { PlanUnplannedColumn } from './PlanUnplannedColumn'
import { DRAG_MIME, readPayload } from './planUtils'
import type { DragPayload, DropHint } from './planUtils'
import type { BoardDnd } from './planDnd'

/**
 * The kanban: one column per plan in its colour plus the grey "Непланирани" column. Owns the
 * HTML5 drag state and turns a drop into one of the page's mutations: reorder inside a column,
 * move-stop across columns, add from the unplanned list, or remove (drop on "Непланирани").
 * Locked plans refuse drops (no preventDefault -> not-allowed cursor, one toast per drag).
 */
export function PlanBoard({
  board,
  zones,
  canEdit,
  highlight,
  onReorder,
  onMove,
  onAdd,
  onRemove,
  onStatus,
  onToggleLock,
}: {
  board: DayBoardDto
  zones: ZoneDto[]
  canEdit: boolean
  highlight: string | null
  /** `to` = the stop's final index inside the plan. */
  onReorder: (plan: DayPlanDto, stopId: string, to: number) => void
  /** `order` = insertion index in the target plan. */
  onMove: (source: DayPlanDto, stopId: string, target: DayPlanDto, order: number) => void
  onAdd: (item: UnplannedStopDto, target: DayPlanDto, order?: number) => void
  onRemove: (plan: DayPlanDto, stopId: string) => void
  onStatus: (plan: DayPlanDto, stopId: string, status: PlanStopStatus) => void
  onToggleLock: (plan: DayPlanDto) => void
}) {
  const { t } = useI18n()
  const dragRef = useRef<DragPayload | null>(null)
  const refusedRef = useRef<string | null>(null)
  const [dragging, setDragging] = useState<DragPayload | null>(null)
  const [hint, setHint] = useState<DropHint | null>(null)
  const plansById = useMemo(() => new Map(board.plans.map((p) => [p.id, p])), [board.plans])

  const allowed = (p: DragPayload, planId: string | null): boolean => {
    if (!canEdit) return false
    if (planId === null) return p.type === 'stop'
    const target = plansById.get(planId)
    return !!target && !target.locked
  }

  const end = () => {
    dragRef.current = null
    refusedRef.current = null
    setDragging(null)
    setHint(null)
  }

  const perform = (p: DragPayload, planId: string | null, index: number) => {
    if (planId === null) {
      if (p.type !== 'stop') return
      const plan = plansById.get(p.planId)
      if (plan) onRemove(plan, p.stopId)
      return
    }
    const target = plansById.get(planId)
    if (!target) return
    if (p.type === 'unplanned') {
      onAdd(p.item, target, index)
      return
    }
    if (p.planId === planId) {
      const from = target.stops.findIndex((s) => s.id === p.stopId)
      const to = from < index ? index - 1 : index
      if (from >= 0 && from !== to) onReorder(target, p.stopId, to)
      return
    }
    const source = plansById.get(p.planId)
    if (source) onMove(source, p.stopId, target, index)
  }

  const dnd: BoardDnd = {
    dragging,
    hint,
    start: (payload, e) => {
      dragRef.current = payload
      e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload))
      e.dataTransfer.setData(
        'text/plain',
        payload.type === 'stop' ? payload.stopId : payload.item.refId,
      )
      e.dataTransfer.effectAllowed = 'move'
      setDragging(payload)
    },
    end,
    enter: (planId) => {
      const p = dragRef.current
      if (!p || planId === null || allowed(p, planId)) return
      if (plansById.get(planId)?.locked && refusedRef.current !== planId) {
        refusedRef.current = planId
        toast(t('dayPlan.lockedRefuse'), 'error')
      }
    },
    over: (planId, index, e) => {
      const p = dragRef.current
      if (!p) return
      if (!allowed(p, planId)) {
        e.dataTransfer.dropEffect = 'none'
        return
      }
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setHint((h) => (h && h.planId === planId && h.index === index ? h : { planId, index }))
    },
    leave: (planId, e: DragEvent<HTMLElement>) => {
      const next = e.relatedTarget as Node | null
      if (next && e.currentTarget.contains(next)) return
      setHint((h) => (h && h.planId === planId ? null : h))
    },
    drop: (planId, index, e) => {
      e.preventDefault()
      const p = readPayload(e.dataTransfer) ?? dragRef.current
      end()
      if (!p || !allowed(p, planId)) return
      perform(p, planId, index)
    },
  }

  return (
    <div className={`job-board plan-board${dragging ? ' plan-board-dragging' : ''}`}>
      {board.plans.map((p, i) => (
        <PlanColumn
          key={p.id}
          plan={p}
          index={i}
          canEdit={canEdit}
          highlight={highlight}
          dnd={dnd}
          onStatus={(stopId, status) => onStatus(p, stopId, status)}
          onRemove={(stopId) => onRemove(p, stopId)}
          onReorder={(stopId, to) => onReorder(p, stopId, to)}
          onToggleLock={() => onToggleLock(p)}
        />
      ))}
      <PlanUnplannedColumn
        items={board.unplanned}
        plans={board.plans}
        zones={zones}
        canEdit={canEdit}
        highlight={highlight}
        dnd={dnd}
        onAdd={(item, planId) => {
          const target = plansById.get(planId)
          if (target) onAdd(item, target)
        }}
      />
    </div>
  )
}
