import type { CreateVisitBody } from '@avroleva/contracts'
import type { Ctx } from '../../../platform/http/ctx.js'

/**
 * Port declared by the caller (ARCHITECTURE section 1.1 rule 2): closing a callback records the
 * close-out visit through whatever implements this; `app.ts` wires the visits module.
 */
export interface VisitRecorder {
  record(ctx: Ctx, body: CreateVisitBody): Promise<{ id: string }>
}

let recorder: VisitRecorder | null = null

export function useVisitRecorder(r: VisitRecorder): void {
  recorder = r
}

export function visitRecorder(): VisitRecorder | null {
  return recorder
}
