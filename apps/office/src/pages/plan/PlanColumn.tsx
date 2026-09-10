import { Fragment } from 'react'
import type { CSSProperties } from 'react'
import type { DayPlanDto, PlanStopStatus } from '@avroleva/contracts'
import { useI18n } from '../../i18n/I18nProvider'
import { Badge } from '../../components/ui'
import { PlanStopCard } from './PlanStopCard'
import { planColour } from './planColours'
import { sofiaTime } from './planUtils'
import type { BoardDnd } from './planDnd'

/**
 * One plan (pair) of the day as a board column in the plan's colour: head (pair, technicians,
 * draft / published badge, lock toggle), totals line and the ordered stop cards. A locked plan
 * keeps its structure: no drops, no reorder, no remove (status changes are still allowed).
 */
export function PlanColumn({
  plan,
  index,
  canEdit,
  highlight,
  dnd,
  onStatus,
  onRemove,
  onReorder,
  onToggleLock,
}: {
  plan: DayPlanDto
  index: number
  canEdit: boolean
  highlight: string | null
  dnd: BoardDnd
  onStatus: (stopId: string, status: PlanStopStatus) => void
  onRemove: (stopId: string) => void
  /** `to` = the stop's final index. */
  onReorder: (stopId: string, to: number) => void
  onToggleLock: () => void
}) {
  const { t, number } = useI18n()
  const colour = planColour(index)
  const structural = canEdit && !plan.locked
  const refuse = !!dnd.dragging && !structural
  const over = dnd.hint?.planId === plan.id
  const n = plan.stops.length
  const doneCount = plan.stops.filter((s) => s.status === 'done').length
  const elevators = new Set(plan.stops.map((s) => s.elevatorId)).size
  const dragId = dnd.dragging?.type === 'stop' ? dnd.dragging.stopId : null
  const cls = [
    'job-col',
    'plan-col',
    plan.locked ? 'plan-col-locked' : '',
    refuse ? 'plan-col-refuse' : '',
    over ? 'plan-col-over' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={cls}
      style={{ '--plan-colour': colour } as CSSProperties}
      onDragEnter={(e) => dnd.enter(plan.id, e)}
      onDragOver={(e) => dnd.over(plan.id, n, e)}
      onDragLeave={(e) => dnd.leave(plan.id, e)}
      onDrop={(e) => dnd.drop(plan.id, n, e)}
    >
      <div className="job-col-head plan-col-head">
        <div className="plan-col-who">
          <div className="plan-col-title">{plan.pairName ?? t('dayPlan.noPair')}</div>
          {plan.userNames.length > 0 ? (
            <div className="small muted">{plan.userNames.join(', ')}</div>
          ) : null}
        </div>
        <div className="plan-col-badges">
          {plan.status === 'published' ? (
            <span title={t('dayPlan.sent')}>
              <Badge kind="ok">
                {t('dayPlan.publishedAt', { time: sofiaTime(plan.publishedAt) })}
              </Badge>
            </span>
          ) : (
            <Badge kind="muted">{t('dayPlan.draft')}</Badge>
          )}
          {canEdit ? (
            <button
              type="button"
              className={`btn btn-small plan-lock${plan.locked ? ' plan-lock-on' : ''}`}
              aria-pressed={plan.locked}
              title={plan.locked ? t('dayPlan.unlock') : t('dayPlan.lockHint')}
              onClick={onToggleLock}
            >
              {plan.locked ? t('dayPlan.locked') : t('dayPlan.lock')}
            </button>
          ) : plan.locked ? (
            <Badge kind="warn">{t('dayPlan.locked')}</Badge>
          ) : null}
        </div>
      </div>
      <div className="small muted plan-col-totals">
        {t('dayPlan.totals', {
          stops: t('dayPlan.stops', { count: n }),
          elevators: t('dayPlan.elevators', { count: elevators }),
          km: number(plan.totals.estKm, { maximumFractionDigits: 1 }),
        })}
        {doneCount > 0 ? ` · ${t('dayPlan.doneOf', { done: doneCount, total: n })}` : ''}
      </div>
      <div className="plan-col-body">
        {plan.stops.map((s, i) => (
          <Fragment key={s.id}>
            {over && dnd.hint?.index === i ? <div className="plan-drop-line" /> : null}
            <PlanStopCard
              stop={s}
              index={i}
              colour={colour}
              canEdit={canEdit}
              structural={structural}
              highlighted={highlight === s.id}
              dragging={dragId === s.id}
              isFirst={i === 0}
              isLast={i === n - 1}
              onStatus={(status) => onStatus(s.id, status)}
              onRemove={() => onRemove(s.id)}
              onMoveUp={() => onReorder(s.id, i - 1)}
              onMoveDown={() => onReorder(s.id, i + 1)}
              onDragStart={(e) => dnd.start({ type: 'stop', planId: plan.id, stopId: s.id }, e)}
              onDragEnd={dnd.end}
              onDragOver={(e, pos) => {
                e.stopPropagation()
                dnd.over(plan.id, pos, e)
              }}
              onDrop={(e, pos) => {
                e.stopPropagation()
                dnd.drop(plan.id, pos, e)
              }}
            />
          </Fragment>
        ))}
        {over && dnd.hint?.index === n ? <div className="plan-drop-line" /> : null}
        {n === 0 ? (
          <div className="job-col-empty muted small">{t('dayPlan.columnEmpty')}</div>
        ) : null}
      </div>
    </div>
  )
}
