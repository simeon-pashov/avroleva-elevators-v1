import type { CSSProperties } from 'react'
import { Link } from 'react-router'
import type { DayPlanDto, UnplannedStopDto, ZoneDto } from '@avroleva/contracts'
import { useI18n } from '../../i18n/I18nProvider'
import { UNPLANNED_COLOUR } from './planColours'
import { sofiaTime, unplannedKey } from './planUtils'
import type { BoardDnd } from './planDnd'

/**
 * "Непланирани": what is due on the day and in no plan. Items drag onto a column or are added
 * through the "Добави към…" select; a stop dropped here leaves its plan.
 */
export function PlanUnplannedColumn({
  items,
  plans,
  zones,
  canEdit,
  highlight,
  dnd,
  onAdd,
}: {
  items: UnplannedStopDto[]
  plans: DayPlanDto[]
  zones: ZoneDto[]
  canEdit: boolean
  highlight: string | null
  dnd: BoardDnd
  onAdd: (item: UnplannedStopDto, planId: string) => void
}) {
  const { t } = useI18n()
  const targets = plans.filter((p) => !p.locked)
  const draggable = canEdit && targets.length > 0
  const over = dnd.hint?.planId === null && !!dnd.hint
  const refuse = !!dnd.dragging && (!canEdit || dnd.dragging.type !== 'stop')
  const dragKey = dnd.dragging?.type === 'unplanned' ? unplannedKey(dnd.dragging.item) : null
  const zoneName = (id: string | null) => (id ? zones.find((z) => z.id === id)?.name : undefined)
  const cls = [
    'job-col',
    'plan-col',
    'plan-col-unplanned',
    refuse ? 'plan-col-refuse' : '',
    over ? 'plan-col-over' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={cls}
      style={{ '--plan-colour': UNPLANNED_COLOUR } as CSSProperties}
      onDragOver={(e) => dnd.over(null, 0, e)}
      onDragLeave={(e) => dnd.leave(null, e)}
      onDrop={(e) => dnd.drop(null, 0, e)}
    >
      <div className="job-col-head plan-col-head">
        <div className="plan-col-title">{t('dayPlan.unplanned')}</div>
        <span className="count-pill">{items.length}</span>
      </div>
      <div className="plan-col-body">
        {items.length === 0 ? (
          <div className="job-col-empty muted small">{t('dayPlan.noUnplanned')}</div>
        ) : (
          items.map((u) => {
            const key = unplannedKey(u)
            const zone = zoneName(u.zoneId)
            const cls = [
              'job-card',
              'plan-card',
              'plan-card-unplanned',
              highlight === key ? 'plan-card-hl' : '',
              dragKey === key ? 'plan-card-dragging' : '',
            ]
              .filter(Boolean)
              .join(' ')
            return (
              <div
                key={key}
                className={cls}
                data-stop-id={key}
                draggable={draggable}
                onDragStart={
                  draggable ? (e) => dnd.start({ type: 'unplanned', item: u }, e) : undefined
                }
                onDragEnd={dnd.end}
              >
                <div className="plan-card-head">
                  <span className={`plan-kind plan-kind-${u.kind}`}>
                    {t(`enum.planStopKind.${u.kind}`)}
                  </span>
                  {zone ? <span className="plan-chip">{zone}</span> : null}
                  <span className="plan-spacer" />
                  {u.plannedAt ? <span className="plan-eta">{sofiaTime(u.plannedAt)}</span> : null}
                </div>
                <div className="plan-card-title">
                  <strong>{u.elevatorInternalNo}</strong>
                </div>
                <div className="small">
                  <Link to={`/buildings/${u.buildingId}`} draggable={false}>
                    {u.buildingAddressText}
                  </Link>
                </div>
                <div className="small muted plan-card-label">{u.label}</div>
                {canEdit && targets.length > 0 ? (
                  <select
                    className="plan-add-select"
                    value=""
                    aria-label={t('dayPlan.addTo')}
                    onChange={(e) => {
                      if (e.target.value) onAdd(u, e.target.value)
                    }}
                  >
                    <option value="">{t('dayPlan.addTo')}</option>
                    {targets.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.pairName ?? t('dayPlan.noPair')}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
