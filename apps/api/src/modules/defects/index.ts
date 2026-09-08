/**
 * defects (L3) - the 17-item catalogue (packages/domain-data/defects/art10.v1.json), free-text
 * defects, stop-lift, the written notice to the building, the follow-up to-do. Owns: defect.
 * Public interface: record, update (status transitions), get, list, listForElevator, catalog,
 * openSummary, listOpenRows; router. Calls registry.elevators.setStatus (L2) in its transaction.
 * Emits DefectRecorded, StopLiftRequired, DefectResolved.
 */
export { defectsRouter } from './http/router.js'
export {
  record,
  update,
  get,
  list,
  listForElevator,
  listForSync,
  catalog,
  openSummary,
  listOpenRows,
  toDefectDto,
} from './service.js'
export { followUpDueAt, canChangeStatus, OPEN_DEFECT_STATUSES } from './domain/followUp.js'
export type { DefectRow } from './repo/defects.js'
export const moduleInfo = { name: 'defects', layer: 3, status: 'active' } as const
