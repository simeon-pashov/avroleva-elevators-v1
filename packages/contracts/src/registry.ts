import { z } from 'zod'
import {
  ContactRole,
  ContractStatus,
  CustomerKind,
  DoorType,
  DriveType,
  ElevatorStatus,
  GeocodeStatus,
} from './enums.js'
import type { ImportStatus } from './enums.js'
import {
  isoDate,
  listQuery,
  nullableDate,
  nullableNumber,
  nullableText,
  optionalText,
  phone,
  uuid,
} from './common.js'

// ---- Customer (ползвател) -----------------------------------------------------------------

export const createCustomerBody = z.object({
  name: z.string().trim().min(2).max(200),
  kind: CustomerKind,
  eik: nullableText(20),
  vatNo: nullableText(20),
  billingAddress: nullableText(500),
  invoiceEmail: z.email().nullable().optional().or(z.literal('')),
  notes: nullableText(4000),
})
export type CreateCustomerBody = z.infer<typeof createCustomerBody>
export const updateCustomerBody = createCustomerBody.partial()
export type UpdateCustomerBody = z.infer<typeof updateCustomerBody>

export interface CustomerDto {
  id: string
  name: string
  kind: z.infer<typeof CustomerKind>
  eik: string | null
  vatNo: string | null
  billingAddress: string | null
  invoiceEmail: string | null
  notes: string | null
  buildingCount?: number
  createdAt: string
  updatedAt: string
}

export const customerListQuery = listQuery.extend({ kind: CustomerKind.optional() })

// ---- Contact ------------------------------------------------------------------------------

export const createContactBody = z
  .object({
    customerId: uuid.nullable().optional(),
    buildingId: uuid.nullable().optional(),
    name: z.string().trim().min(2).max(120),
    role: ContactRole.default('house_manager'),
    phone: phone.nullable().optional().or(z.literal('')),
    hasViber: z.boolean().default(false),
    email: z.email().nullable().optional().or(z.literal('')),
    isPrimary: z.boolean().default(false),
    notes: nullableText(1000),
  })
  .refine((c) => c.customerId || c.buildingId, {
    message: 'validation.contactNeedsParent',
    path: ['customerId'],
  })
export type CreateContactBody = z.infer<typeof createContactBody>

export const updateContactBody = z.object({
  customerId: uuid.nullable().optional(),
  buildingId: uuid.nullable().optional(),
  name: z.string().trim().min(2).max(120).optional(),
  role: ContactRole.optional(),
  phone: phone.nullable().optional().or(z.literal('')),
  hasViber: z.boolean().optional(),
  email: z.email().nullable().optional().or(z.literal('')),
  isPrimary: z.boolean().optional(),
  notes: nullableText(1000),
})
export type UpdateContactBody = z.infer<typeof updateContactBody>

export interface ContactDto {
  id: string
  customerId: string | null
  buildingId: string | null
  name: string
  role: z.infer<typeof ContactRole>
  phone: string | null
  hasViber: boolean
  email: string | null
  isPrimary: boolean
  notes: string | null
  createdAt: string
}

export const contactListQuery = listQuery.extend({
  customerId: uuid.optional(),
  buildingId: uuid.optional(),
})

// ---- Building -----------------------------------------------------------------------------

export const address = z.object({
  city: z.string().trim().min(1).max(100),
  postcode: optionalText(10),
  oblast: optionalText(100),
  district: optionalText(100),
  street: optionalText(200),
  number: optionalText(20),
  block: optionalText(20),
  entrance: optionalText(10),
})
export type Address = z.infer<typeof address>

export const lat = z.number().min(-90).max(90)
export const lng = z.number().min(-180).max(180)

export const createBuildingBody = z.object({
  customerId: uuid.nullable().optional(),
  address,
  addressText: optionalText(500),
  lat: nullableNumber(lat),
  lng: nullableNumber(lng),
  accessNotes: nullableText(2000),
  keysLocation: nullableText(500),
  notes: nullableText(4000),
})
export type CreateBuildingBody = z.infer<typeof createBuildingBody>
export const updateBuildingBody = createBuildingBody.partial()
export type UpdateBuildingBody = z.infer<typeof updateBuildingBody>

export const setBuildingLocationBody = z.object({ lat, lng })

export interface BuildingDto {
  id: string
  customerId: string | null
  customerName?: string | null
  address: Address
  addressText: string
  lat: number | null
  lng: number | null
  geocodeStatus: z.infer<typeof GeocodeStatus>
  geocodeConfidence: number | null
  geocodeProvider: string | null
  accessNotes: string | null
  keysLocation: string | null
  notes: string | null
  elevatorCount?: number
  createdAt: string
  updatedAt: string
}

export interface BuildingDetailDto extends BuildingDto {
  elevators: ElevatorDto[]
  contacts: ContactDto[]
  contracts: ContractDto[]
}

export interface BuildingPinDto {
  id: string
  addressText: string
  lat: number
  lng: number
  elevatorCount: number
}

export const buildingListQuery = listQuery.extend({
  customerId: uuid.optional(),
  geocodeStatus: GeocodeStatus.optional(),
})

// ---- Elevator -----------------------------------------------------------------------------

export const createElevatorBody = z.object({
  buildingId: uuid,
  internalNo: z.string().trim().min(1).max(60),
  regNo: nullableText(60),
  inspectionBody: nullableText(200),
  manufacturer: nullableText(120),
  year: nullableNumber(z.number().int().min(1900).max(2100)),
  driveType: DriveType.default('electric'),
  doorType: DoorType.default('manual'),
  stops: z.number().int().min(2).max(60),
  loadKg: nullableNumber(z.number().int().min(50).max(10000)),
  status: ElevatorStatus.default('active'),
  checkIntervalDays: nullableNumber(z.number().int().min(1).max(365)),
  lastCheckAt: nullableDate,
  nextInspectionAt: nullableDate,
  alarmDevicePhone: nullableText(30),
  alarmSimOperator: nullableText(60),
  notes: nullableText(4000),
})
export type CreateElevatorBody = z.infer<typeof createElevatorBody>
export const updateElevatorBody = createElevatorBody.partial()
export type UpdateElevatorBody = z.infer<typeof updateElevatorBody>

export interface ElevatorDto {
  id: string
  buildingId: string
  buildingAddressText?: string
  internalNo: string
  regNo: string | null
  inspectionBody: string | null
  manufacturer: string | null
  year: number | null
  driveType: z.infer<typeof DriveType>
  doorType: z.infer<typeof DoorType>
  stops: number
  loadKg: number | null
  status: z.infer<typeof ElevatorStatus>
  checkIntervalDays: number | null
  /** Effective interval: elevator.checkIntervalDays ?? tenant.settings.checkIntervalDays. */
  effectiveIntervalDays: number
  lastCheckAt: string | null
  /** lastCheckAt + effectiveIntervalDays (date only); null when never checked. */
  nextCheckDue: string | null
  nextInspectionAt: string | null
  alarmDevicePhone: string | null
  alarmSimOperator: string | null
  publicCode: string
  notes: string | null
  createdAt: string
  updatedAt: string
}

export const elevatorListQuery = listQuery.extend({
  buildingId: uuid.optional(),
  status: ElevatorStatus.optional(),
})

// ---- Contract -----------------------------------------------------------------------------

export const contractLine = z.object({
  elevatorId: uuid,
  /** Integer euro cents (ARCHITECTURE section 3: money as cents). */
  monthlyPriceCents: z.number().int().min(0).max(100_000_00),
})
export type ContractLine = z.infer<typeof contractLine>

export const createContractBody = z.object({
  customerId: uuid,
  buildingId: uuid,
  startDate: isoDate,
  endDate: nullableDate,
  status: ContractStatus.default('active'),
  paymentDay: nullableNumber(z.number().int().min(1).max(28)),
  notes: nullableText(4000),
  lines: z.array(contractLine).min(1),
})
export type CreateContractBody = z.infer<typeof createContractBody>

export const updateContractBody = createContractBody.partial()
export type UpdateContractBody = z.infer<typeof updateContractBody>

export const terminateContractBody = z.object({
  endDate: isoDate,
  reason: nullableText(1000),
})
export type TerminateContractBody = z.infer<typeof terminateContractBody>

export interface ContractLineDto {
  id: string
  elevatorId: string
  elevatorInternalNo?: string
  monthlyPriceCents: number
  fromDate: string | null
  toDate: string | null
}

export interface ContractDto {
  id: string
  customerId: string
  customerName?: string
  buildingId: string
  buildingAddressText?: string
  startDate: string
  endDate: string | null
  status: z.infer<typeof ContractStatus>
  paymentDay: number | null
  notes: string | null
  terminatedReason: string | null
  lines: ContractLineDto[]
  monthlyTotalCents: number
  createdAt: string
  updatedAt: string
}

export const contractListQuery = listQuery.extend({
  customerId: uuid.optional(),
  buildingId: uuid.optional(),
  status: ContractStatus.optional(),
})

// ---- CSV import ---------------------------------------------------------------------------

/** Column order of the import template (MVP-PLAN section 3). Headers are Bulgarian. */
export const IMPORT_COLUMNS = [
  'Ползвател',
  'Тип ползвател',
  'Домоуправител',
  'Телефон',
  'Viber',
  'E-mail',
  'Град',
  'Област',
  'Район/ж.к.',
  'Улица и №',
  'Блок',
  'Вход',
  'Асансьор №',
  'Рег. №',
  'Надзорен орган',
  'Производител',
  'Година',
  'Вид',
  'Врати',
  'Спирки',
  'Товар (кг)',
  'Месечна цена (€)',
  'Договор от',
  'Последна проверка',
  'Последен технически преглед',
  'Следващ технически преглед',
  'Телефон на аварийното устройство',
  'Оператор на SIM',
  'Ширина',
  'Дължина',
] as const

export interface ImportRowIssue {
  row: number
  column: string
  code: string
  message: string
  level: 'error' | 'warning'
}

export interface ImportPreviewRow {
  row: number
  customerName: string
  customerKind: z.infer<typeof CustomerKind>
  contactName: string | null
  contactPhone: string | null
  contactViber: boolean
  contactEmail: string | null
  address: Address
  addressText: string
  lat: number | null
  lng: number | null
  internalNo: string
  regNo: string | null
  inspectionBody: string | null
  manufacturer: string | null
  year: number | null
  driveType: z.infer<typeof DriveType>
  doorType: z.infer<typeof DoorType>
  stops: number
  loadKg: number | null
  monthlyPriceCents: number | null
  contractStart: string | null
  lastCheckAt: string | null
  lastInspectionAt: string | null
  nextInspectionAt: string | null
  alarmDevicePhone: string | null
  alarmSimOperator: string | null
}

export interface ImportBatchDto {
  id: string
  filename: string
  status: z.infer<typeof ImportStatus>
  rowCount: number
  errorCount: number
  warningCount: number
  issues: ImportRowIssue[]
  rows: ImportPreviewRow[]
  created: {
    customers: number
    contacts: number
    buildings: number
    elevators: number
    contracts: number
  } | null
  createdAt: string
}

export const importPreviewBody = z.object({
  filename: z.string().trim().min(1).max(200).default('import.csv'),
  /** Raw CSV text (UTF-8, comma or semicolon separated, header row required). */
  csv: z.string().min(1).max(5_000_000),
})
export type ImportPreviewBody = z.infer<typeof importPreviewBody>

// ---- Geocode ------------------------------------------------------------------------------

export interface GeocodeResultDto {
  status: z.infer<typeof GeocodeStatus>
  lat: number | null
  lng: number | null
  confidence: number | null
  provider: string | null
}
