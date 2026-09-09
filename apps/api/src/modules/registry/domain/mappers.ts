import { contractBilling } from '@avroleva/contracts'
import type {
  Address,
  BuildingDto,
  ContactDto,
  ContractDto,
  ContractLineDto,
  CustomerDto,
  ElevatorDetailDto,
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
import { toDateOnly, todayInSofia } from '../../../platform/clock.js'
import { urls } from '../../../platform/urls.js'
import { computeNextDue, dueStateOf, effectiveIntervalDays } from './due.js'
import type { ScheduleSettings } from './due.js'
import type { ElevatorDetailRow } from '../repo/elevators.js'

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
  settings: ScheduleSettings,
  today: string = todayInSofia(),
): ElevatorDto {
  const interval = effectiveIntervalDays(e, settings)
  const lastCheckAt = toDateOnly(e.lastCheckAt)
  // The stored column is authoritative; fall back to a fresh computation for rows written before
  // the column existed (or by a seed that skipped it).
  const nextCheckDue = toDateOnly(e.nextCheckDueAt) ?? computeNextDue(e, settings)
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
    goodsOnly: e.goodsOnly,
    stops: e.stops,
    loadKg: e.loadKg,
    status: e.status,
    checkIntervalDays: e.checkIntervalDays,
    effectiveIntervalDays: interval,
    lastCheckAt,
    nextCheckDue,
    nextCheckOverrideAt: toDateOnly(e.nextCheckOverrideAt),
    dueState: dueStateOf(nextCheckDue, e.status, today),
    nextInspectionAt: toDateOnly(e.nextInspectionAt),
    alarmDevicePhone: e.alarmDevicePhone,
    alarmSimOperator: e.alarmSimOperator,
    publicCode: e.publicCode,
    stoppedAt: e.stoppedAt ? iso(e.stoppedAt) : null,
    stopReason: e.stopReason,
    notes: e.notes,
    createdAt: iso(e.createdAt),
    updatedAt: iso(e.updatedAt),
  }
}

export function toElevatorDetailDto(
  e: ElevatorDetailRow,
  settings: ScheduleSettings,
  today: string = todayInSofia(),
): ElevatorDetailDto {
  const contact =
    e.building.contacts.find((c) => c.role === 'house_manager') ?? e.building.contacts[0] ?? null
  const line = e.contractLines[0] ?? null
  const address = e.building.address as Address
  return {
    ...toElevatorDto(e, settings, today),
    buildingAddressText: e.building.addressText,
    buildingEntrance: address?.entrance ?? null,
    customerId: e.building.customerId,
    customerName: e.building.customer?.name ?? null,
    contact: contact
      ? { id: contact.id, name: contact.name, phone: contact.phone, role: contact.role }
      : null,
    contractId: line?.contractId ?? null,
    monthlyPriceCents: line?.monthlyPriceCents ?? null,
    publicToken: e.publicToken,
    publicUrl: urls.publicPage(e.publicToken),
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
    billing: parseContractBilling(c.billing),
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

/** The per-contract billing override (ADR 0001) or null; a malformed value reads as null. */
export function parseContractBilling(raw: unknown): ContractDto['billing'] {
  if (raw == null) return null
  const r = contractBilling.safeParse(raw)
  return r.success ? { ...r.data, anchorDay: r.data.anchorDay ?? null } : null
}
