import type { CSSProperties, DragEvent } from 'react'
import { Link } from 'react-router'
import type { PlanStopDto, PlanStopStatus } from '@avroleva/contracts'
import { useI18n } from '../../i18n/I18nProvider'
import { Badge } from '../../components/ui'
import { sofiaTime } from './planUtils'

/**
 * One stop of a plan: sequence circle in the plan's colour, kind pill, lift, address, contact,
 * ETA and the reason. Draggable (HTML5) when the office may restructure the plan; ↑/↓ buttons
 * are the keyboard fallback. `data-stop-id` lets a map pin scroll to the card.
 */
export function PlanStopCard({
  stop,
  index,
  colour,
  canEdit,
  structural,
  highlighted,
  dragging,
  isFirst,
  isLast,
  onStatus,
  onRemove,
  onMoveUp,
  onMoveDown,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: {
  stop: PlanStopDto
  index: number
  colour: string
  /** Status buttons (owner / office). */
  canEdit: boolean
  /** Reorder / remove / drag (owner / office and the plan is not locked). */
  structural: boolean
  highlighted: boolean
  dragging: boolean
  isFirst: boolean
  isLast: boolean
  onStatus: (status: PlanStopStatus) => void
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onDragStart: (e: DragEvent<HTMLDivElement>) => void
  onDragEnd: () => void
  /** `position` = insertion index: before this card (upper half) or after it (lower half). */
  onDragOver: (e: DragEvent<HTMLDivElement>, position: number) => void
  onDrop: (e: DragEvent<HTMLDivElement>, position: number) => void
}) {
  const { t, number } = useI18n()
  const done = stop.status === 'done'
  const skipped = stop.status === 'skipped'
  const cls = [
    'job-card',
    'plan-card',
    done ? 'plan-card-done' : '',
    skipped ? 'plan-card-skipped' : '',
    highlighted ? 'plan-card-hl' : '',
    dragging ? 'plan-card-dragging' : '',
  ]
    .filter(Boolean)
    .join(' ')
  const position = (e: DragEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return e.clientY - r.top > r.height / 2 ? index + 1 : index
  }

  return (
    <div
      className={cls}
      data-stop-id={stop.id}
      style={{ '--plan-colour': colour } as CSSProperties}
      draggable={structural}
      onDragStart={structural ? onDragStart : undefined}
      onDragEnd={onDragEnd}
      onDragOver={(e) => onDragOver(e, position(e))}
      onDrop={(e) => onDrop(e, position(e))}
    >
      <div className="plan-card-head">
        <span className="plan-seq" aria-hidden="true">
          {done ? '✓' : index + 1}
        </span>
        <span className={`plan-kind plan-kind-${stop.kind}`}>
          {t(`enum.planStopKind.${stop.kind}`)}
        </span>
        {stop.manual ? <span className="plan-chip">{t('dayPlan.manual')}</span> : null}
        <span className="plan-spacer" />
        {stop.eta ? (
          <span className="plan-eta" title={t('dayPlan.eta')}>
            {sofiaTime(stop.eta)}
          </span>
        ) : null}
      </div>
      <div className="plan-card-title">
        <strong>{stop.elevatorInternalNo}</strong>
        {stop.elevatorRegNo ? <span className="muted small"> · {stop.elevatorRegNo}</span> : null}
      </div>
      <div className="small">
        <Link to={`/buildings/${stop.buildingId}`} draggable={false}>
          {stop.buildingAddressText}
        </Link>
      </div>
      {stop.customerName ? <div className="small muted">{stop.customerName}</div> : null}
      {stop.contact ? (
        <div className="small muted">
          {stop.contact.name}
          {stop.contact.phone ? (
            <>
              {' · '}
              <a href={`tel:${stop.contact.phone}`} draggable={false}>
                {stop.contact.phone}
              </a>
            </>
          ) : null}
        </div>
      ) : null}
      <div className="small muted plan-card-label">
        {stop.label}
        {stop.legKm > 0 ? (
          <span className="plan-km">
            {' · '}
            {t('dayPlan.km', { km: number(stop.legKm, { maximumFractionDigits: 1 }) })}
          </span>
        ) : null}
      </div>
      {stop.notes ? <div className="small muted">{stop.notes}</div> : null}
      {done || skipped ? (
        <div className="plan-card-status">
          <Badge kind={done ? 'ok' : 'warn'}>{t(`enum.planStopStatus.${stop.status}`)}</Badge>
          {stop.completedAt ? (
            <span className="muted small"> {sofiaTime(stop.completedAt)}</span>
          ) : null}
        </div>
      ) : null}
      {canEdit ? (
        <div className="plan-card-actions">
          {stop.status === 'planned' ? (
            <>
              <button
                type="button"
                className="btn btn-small btn-primary"
                onClick={() => onStatus('done')}
              >
                {t('dayPlan.done')}
              </button>
              <button type="button" className="btn btn-small" onClick={() => onStatus('skipped')}>
                {t('dayPlan.skip')}
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-small" onClick={() => onStatus('planned')}>
              {t('dayPlan.reopen')}
            </button>
          )}
          {structural ? (
            <>
              <button
                type="button"
                className="btn btn-small plan-btn-icon"
                disabled={isFirst}
                title={t('dayPlan.moveUp')}
                aria-label={t('dayPlan.moveUp')}
                onClick={onMoveUp}
              >
                ↑
              </button>
              <button
                type="button"
                className="btn btn-small plan-btn-icon"
                disabled={isLast}
                title={t('dayPlan.moveDown')}
                aria-label={t('dayPlan.moveDown')}
                onClick={onMoveDown}
              >
                ↓
              </button>
              <button
                type="button"
                className="btn btn-small plan-btn-icon plan-btn-remove"
                title={t('dayPlan.remove')}
                aria-label={t('dayPlan.remove')}
                onClick={onRemove}
              >
                ×
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
