/**
 * visits (L3) - the visit record (evidence). Owns: visit, visit_technician.
 * Public interface: record (idempotent), amend, get, list, listForElevator; router.
 * Emits VisitRecorded, VisitAmended. Calls registry.elevators.recordCheck (L2) in its transaction.
 */
export { visitsRouter } from './http/router.js'
export {
  record,
  amend,
  get,
  list,
  listForElevator,
  listSince,
  latestVisitAt,
  toVisitDto,
  qualityFlags,
  listForRetention,
  markPhotosPurged,
  listForBuildingPeriod,
  countInPeriod,
} from './service.js'
export { useChecklistResolver } from './domain/ports.js'
export type { ChecklistResolver } from './domain/ports.js'
export const moduleInfo = { name: 'visits', layer: 3, status: 'active' } as const
