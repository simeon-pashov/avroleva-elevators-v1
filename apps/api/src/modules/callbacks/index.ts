/**
 * callbacks (L3) - the авария flow. Owns: callback, callback_event.
 * Public interface: open (office / technician / public), dispatch, transition (on_site, released,
 * restored), close (records the close-out visit through the VisitRecorder port wired in app.ts),
 * get, list, listForElevator, openSummary, openByElevator, openOverSla; router.
 * Emits CallbackOpened / Dispatched / OnSite / Released / Restored / Closed.
 */
export { callbacksRouter } from './http/router.js'
export {
  open,
  dispatch,
  transition,
  close,
  get,
  list,
  listForElevator,
  listForSync,
  openSummary,
  openByElevator,
  openOverSla,
  listOpenRows,
  toCallbackDto,
  actorFromCtx,
  clockFlags,
} from './service.js'
export type { CallbackActor } from './service.js'
export { useVisitRecorder } from './domain/ports.js'
export type { VisitRecorder } from './domain/ports.js'
export {
  slaState,
  responseMinutes,
  elapsedMinutes,
  canTransition,
  OPEN_STATUSES,
  AT_RISK_RATIO,
} from './domain/sla.js'
export type { CallbackRow } from './repo/callbacks.js'
export const moduleInfo = { name: 'callbacks', layer: 3, status: 'active' } as const
