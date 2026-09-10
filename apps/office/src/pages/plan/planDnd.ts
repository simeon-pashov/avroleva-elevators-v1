import type { DragEvent } from 'react'
import type { DragPayload, DropHint } from './planUtils'

/**
 * The board owns the drag state (plain HTML5 DnD); columns and cards only report where the
 * pointer is. `planId === null` is the "Непланирани" column (a drop there removes the stop).
 */
export interface BoardDnd {
  dragging: DragPayload | null
  hint: DropHint | null
  start: (payload: DragPayload, e: DragEvent<HTMLElement>) => void
  end: () => void
  enter: (planId: string | null, e: DragEvent<HTMLElement>) => void
  over: (planId: string | null, index: number, e: DragEvent<HTMLElement>) => void
  leave: (planId: string | null, e: DragEvent<HTMLElement>) => void
  drop: (planId: string | null, index: number, e: DragEvent<HTMLElement>) => void
}
