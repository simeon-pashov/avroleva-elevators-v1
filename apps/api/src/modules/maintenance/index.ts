/**
 * maintenance (L3) - the 30-day cycle engine and the checklist templates. Owns: checklist_template
 * (system rows with tenantId NULL + tenant clones). The denormalised `elevator.nextCheckDueAt` /
 * `nextCheckOverrideAt` columns belong to the registry, which applies the rules injected from
 * here (`scheduleRules`, wired in app.ts). Jobs and routes (ARCHITECTURE section 1.2) are later.
 * Public interface: nextDue, dueState, dueBoard, reschedule, checklists.*; router.
 */
import type { ScheduleRules } from '../registry/index.js'
import { dueState, nextDue } from './domain/nextDue.js'

export { maintenanceRouter } from './http/router.js'
export { dueBoard, reschedule } from './service.js'
export * as checklists from './service/checklists.js'
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
