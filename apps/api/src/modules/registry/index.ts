/**
 * registry (L2) - public interface. Owns: customer, contact, building, elevator, contract,
 * contract_elevator, import_batch. Other modules import ONLY from this file.
 */
import * as customersRepo from './repo/customers.js'
import * as buildingsRepo from './repo/buildings.js'
import * as elevatorsRepo from './repo/elevators.js'
import * as contractsRepo from './repo/contracts.js'

export { registryRouter } from './http/router.js'
export * as customers from './service/customers.js'
export * as contacts from './service/contacts.js'
export * as buildings from './service/buildings.js'
export * as elevators from './service/elevators.js'
export * as contracts from './service/contracts.js'
export * as imports from './service/imports.js'
export * as geo from './service/geo.js'
export { distanceMetres, withinRadius, viewboxFor } from './domain/geo.js'
export { parseImport } from './domain/import.js'
export { parseCsv, toCsv } from './domain/csv.js'
export { buildAddressText, normalizeRegNo, normalizePhone } from './domain/address.js'
export {
  effectiveIntervalDays,
  nextCheckDue,
  computeNextDue,
  dueStateOf,
  useScheduleRules,
} from './domain/due.js'
export type { ScheduleRules, DueInput, ScheduleSettings } from './domain/due.js'
export type { ElevatorDetailRow } from './repo/elevators.js'

/** Basic counts for the platform admin page (used by the admin facade). */
export async function counts(tenantId: string) {
  const [customers, buildings, elevators, contracts] = await Promise.all([
    customersRepo.countCustomers(tenantId),
    buildingsRepo.countBuildings(tenantId),
    elevatorsRepo.countElevators(tenantId),
    contractsRepo.countContracts(tenantId),
  ])
  return { customers, buildings, elevators, contracts }
}
