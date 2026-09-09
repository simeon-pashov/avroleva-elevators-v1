/**
 * maintenance (L3) - the 30-day cycle engine, the checklist templates and (step 9) the technician
 * pairs and the day plan. Owns: checklist_template (system rows with tenantId NULL + tenant
 * clones), technician_pair, day_plan. The denormalised `elevator.nextCheckDueAt` /
 * `nextCheckOverrideAt` columns belong to the registry, which applies the rules injected from
 * here (`scheduleRules`, wired in wiring.ts). What the day plan reads from callbacks / jobs /
 * calendar comes through the PlanSources port (domain/ports.ts), also wired there.
 * Public interface: nextDue, dueState, dueBoard, reschedule, checklists.*, pairs.*, plans.*,
 * listMyPlans, setStopStatus, markStopDoneByRef, route / plan helpers; router.
 */
import type { ScheduleRules } from '../registry/index.js'
import { dueState, nextDue } from './domain/nextDue.js'

export { maintenanceRouter } from './http/router.js'
export { dueBoard, reschedule } from './service.js'
export * as checklists from './service/checklists.js'
export * as pairs from './service/pairs.js'
export * as plans from './service/plans.js'
export { listMyPlans, setStopStatus, markStopDoneByRef, parseStops } from './service/plans.js'
export {
  nextDue,
  dueState,
  addMonths,
  endOfMonth,
  daysBetween,
  SOON_DAYS,
} from './domain/nextDue.js'
export type { NextDueInput, CycleStrategy } from './domain/nextDue.js'
export {
  orderNearestNeighbour,
  legsKm,
  estKm,
  etaSequence,
  sofiaLocalToUtc,
  sofiaOffsetMs,
} from './domain/route.js'
export type { RoutePoint, RouteStop } from './domain/route.js'
export {
  mergeRegeneration,
  stopKey,
  renumber,
  dedupeStops,
  chunkEvenly,
  pairIndexForUsers,
  isKept,
} from './domain/plan.js'
export { usePlanSources } from './domain/ports.js'
export type {
  PlanSources,
  PlanSourceCallback,
  PlanSourceJob,
  PlanSourceInspection,
} from './domain/ports.js'

/** Implementation of the registry's schedule port. */
export const scheduleRules: ScheduleRules = { nextDue, dueState }

export const moduleInfo = { name: 'maintenance', layer: 3, status: 'active' } as const
