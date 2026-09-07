export * from './common.js'
export * from './enums.js'
export * from './tenancy.js'
export * from './registry.js'
export * from './maintenance.js'
export * from './visits.js'
export * from './billing.js'
export * from './callbacks.js'
export * from './defects.js'
export * from './calendar.js'
export * from './reporting.js'

export interface HealthDto {
  ok: boolean
  db: 'up' | 'down'
  version: string
  time: string
}
