import type {
  Address,
  BuildingDto,
  ContactDto,
  ContractDto,
  ContractLineDto,
  CustomerDto,
  ElevatorDto,
  ImportBatchDto,
  ImportPreviewRow,
  ImportRowIssue,
} from '@avroleva/contracts'
import type {
  Building,
  Contact,
  Contract,
  ContractElevator,
  Customer,
  Elevator,
  ImportBatch,
} from '../../../generated/prisma/index.js'
import { toDateOnly } from '../../../platform/clock.js'
import { effectiveIntervalDays, nextCheckDue } from './due.js'

const iso = (d: Date) => d.toISOString()

export function toCustomerDto(c: Customer & { _count?: { buildings: number } }): CustomerDto {
  return {
    id: c.id,
    name: c.name,
    kind: c.kind,
    eik: c.eik,
    vatNo: c.vatNo,
    billingAddress: c.billingAddress,
    invoiceEmail: c.invoiceEmail,
    notes: c.notes,
    ...(c._count ? { buildingCount: c._count.buildings } : {}),
    createdAt: iso(c.createdAt),
    updatedAt: iso(c.updatedAt),
  }
}

export function toContactDto(c: Contact): ContactDto {
  return {
    id: c.id,
    customerId: c.customerId,
    buildingId: c.buildingId,
    name: c.name,
    role: c.role,
    phone: c.phone,
    hasViber: c.hasViber,
    email: c.email,
    isPrimary: c.isPrimary,
    notes: c.notes,
    createdAt: iso(c.createdAt),
  }
}

export function toBuildingDto(
  b: Building & { customer?: { name: string } | null; _count?: { elevators: number } },
): BuildingDto {
  return {
    id: b.id,
    customerId: b.customerId,
    customerName: b.customer?.name ?? null,
    address: b.address as Address,
    addressText: b.addressText,
    lat: b.lat,
    lng: b.lng,
    geocodeStatus: b.geocodeStatus,
    geocodeConfidence: b.geocodeConfidence,
    geocodeProvider: b.geocodeProvider,
    accessNotes: b.accessNotes,
    keysLocation: b.keysLocation,
    notes: b.notes,
    ...(b._count ? { elevatorCount: b._count.elevators } : {}),
    createdAt: iso(b.createdAt),
    updatedAt: iso(b.updatedAt),
  }
}

export function toElevatorDto(
  e: Elevator & { building?: { addressText: string } | null },
  settings: { checkIntervalDays: number },
): ElevatorDto {
  const interval = effectiveIntervalDays(e, settings)
  const lastCheckAt = toDateOnly(e.lastCheckAt)
  return {
    id: e.id,
    buildingId: e.buildingId,
    ...(e.building ? { buildingAddressText: e.building.addressText } : {}),
    internalNo: e.internalNo,
    regNo: e.regNo,
    inspectionBody: e.inspectionBody,
    manufacturer: e.manufacturer,
    year: e.year,
    driveType: e.driveType,
    doorType: e.doorType,
    stops: e.stops,
    loadKg: e.loadKg,
    status: e.status,
    checkIntervalDays: e.checkIntervalDays,
    effectiveIntervalDays: interval,
    lastCheckAt,
    nextCheckDue: nextCheckDue(lastCheckAt, interval),
    nextInspectionAt: toDateOnly(e.nextInspectionAt),
    alarmDevicePhone: e.alarmDevicePhone,
    alarmSimOperator: e.alarmSimOperator,
    publicCode: e.publicCode,
    notes: e.notes,
    createdAt: iso(e.createdAt),
    updatedAt: iso(e.updatedAt),
  }
}

export function toContractLineDto(
  l: ContractElevator & { elevator?: { internalNo: string } | null },
): ContractLineDto {
  return {
    id: l.id,
    elevatorId: l.elevatorId,
    ...(l.elevator ? { elevatorInternalNo: l.elevator.internalNo } : {}),
    monthlyPriceCents: l.monthlyPriceCents,
    fromDate: toDateOnly(l.fromDate),
    toDate: toDateOnly(l.toDate),
  }
}

export function toContractDto(
  c: Contract & {
    lines: Array<ContractElevator & { elevator?: { internalNo: string } | null }>
    customer?: { name: string } | null
    building?: { addressText: string } | null
  },
): ContractDto {
  const activeLines = c.lines.filter((l) => !l.toDate)
  return {
    id: c.id,
    customerId: c.customerId,
    ...(c.customer ? { customerName: c.customer.name } : {}),
    buildingId: c.buildingId,
    ...(c.building ? { buildingAddressText: c.building.addressText } : {}),
    startDate: toDateOnly(c.startDate)!,
    endDate: toDateOnly(c.endDate),
    status: c.status,
    paymentDay: c.paymentDay,
    notes: c.notes,
    terminatedReason: c.terminatedReason,
    lines: c.lines.map(toContractLineDto),
    monthlyTotalCents: activeLines.reduce((s, l) => s + l.monthlyPriceCents, 0),
    createdAt: iso(c.createdAt),
    updatedAt: iso(c.updatedAt),
  }
}

export function toImportBatchDto(b: ImportBatch): ImportBatchDto {
  const issues = (b.issues as unknown as ImportRowIssue[]) ?? []
  const created = b.createdRows as ImportBatchDto['created'] | null
  return {
    id: b.id,
    filename: b.filename,
    status: b.status,
    rowCount: b.rowCount,
    errorCount: issues.filter((i) => i.level === 'error').length,
    warningCount: issues.filter((i) => i.level === 'warning').length,
    issues,
    rows: (b.rows as unknown as ImportPreviewRow[]) ?? [],
    created: created ?? null,
    createdAt: iso(b.createdAt),
  }
}
