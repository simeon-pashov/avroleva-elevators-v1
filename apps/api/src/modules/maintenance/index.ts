/**
 * maintenance (L3) - the 30-day cycle engine. Owns no table yet: the denormalised
 * `elevator.nextCheckDueAt` / `nextCheckOverrideAt` columns belong to the registry, which applies
 * the rules injected from here (`scheduleRules`, wired in app.ts). Jobs, checklist templates and
 * routes (ARCHITECTURE section 1.2) come with the technician app.
 * Public interface: nextDue, dueState, dueBoard, reschedule; router.
 */
import type { ScheduleRules } from '../registry/index.js'
import { dueState, nextDue } from './domain/nextDue.js'

export { maintenanceRouter } from './http/router.js'
export { dueBoard, reschedule } from './service.js'
export {
  nextDue,
  dueState,
  addMonths,
  endOfMonth,
  daysBetween,
  SOON_DAYS,
} from './domain/nextDue.js'
export type { NextDueInput, CycleStrategy } from './domain/nextDue.js'

/** Implementation of the registry's schedule port. */
export const scheduleRules: ScheduleRules = { nextDue, dueState }

export const moduleInfo = { name: 'maintenance', layer: 3, status: 'active' } as const
