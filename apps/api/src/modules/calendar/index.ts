/**
 * calendar (L3) - inspections (технически прегледи), alarm-device tests and the rules behind the
 * deadlines. Owns: inspection, alarm_device_test. The merged "Срокове" view lives in reporting
 * (L4), which reads this module, registry, defects and callbacks through their interfaces.
 * Public interface: create, update, get, list, listForElevator, scheduledRows, logAlarmTest,
 * listAlarmTests, latestAlarmTests, rulesFor, nextInspectionDue, severityOf; router.
 * Calls registry.elevators.setNextInspection (L2) in its transaction. Emits InspectionRecorded,
 * AlarmDeviceTested.
 */
export { calendarRouter } from './http/router.js'
export {
  create,
  update,
  get,
  list,
  listForElevator,
  scheduledRows,
  logAlarmTest,
  listAlarmTests,
  latestAlarmTests,
  toInspectionDto,
} from './service.js'
export {
  rulesFor,
  nextInspectionDue,
  addMonthsDateOnly,
  severityOf,
  daysBetween,
} from './domain/inspectionDue.js'
export type { InspectionRules } from './domain/inspectionDue.js'
export type { InspectionRow } from './repo/calendar.js'
export const moduleInfo = { name: 'calendar', layer: 3, status: 'active' } as const
