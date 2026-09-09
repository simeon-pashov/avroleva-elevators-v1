import { prismaBase as db } from '../platform/db/prisma.js'
import { newId, newPublicCode, newPublicToken } from '../platform/ids.js'
import { addDays, fromDateOnly } from '../platform/clock.js'
import {
  buildAddressText,
  normalizePhone,
  normalizeRegNo,
  useScheduleRules,
} from '../modules/registry/index.js'
import { nextDue, scheduleRules } from '../modules/maintenance/index.js'
import type {
  ContractStatus,
  CustomerKind,
  DoorType,
  DriveType,
  ElevatorStatus,
} from '../generated/prisma/index.js'
import type { Address } from '@avroleva/contracts'

useScheduleRules(scheduleRules)

/**
 * Demo registry (ADR 0001 section 6): six customers, twelve Sofia buildings with a contact each,
 * twenty lifts of every drive / door type and status, one active contract per building. Used
 * only when a tenant has no buildings; idempotent by natural keys (name, address, internal no).
 */
interface CustomerSeed {
  key: string
  name: string
  kind: CustomerKind
  eik?: string
  billingAddress?: string
}

const CUSTOMERS: CustomerSeed[] = [
  { key: 'mladost25', name: 'ЕС „Младост 1, бл. 25“', kind: 'etazhna_sobstvenost' },
  { key: 'lyulin512', name: 'ЕС „Люлин 5, бл. 512“', kind: 'etazhna_sobstvenost' },
  {
    key: 'domoplus',
    name: '„Домоуправител Плюс“ ЕООД',
    kind: 'professional_manager',
    eik: '203456789',
    billingAddress: 'София, бул. Цариградско шосе 115',
  },
  {
    key: 'vitosha',
    name: '„Витоша Пропъртис“ ООД',
    kind: 'company',
    eik: '201234567',
    billingAddress: 'София, бул. Витоша 100',
  },
  { key: 'krasno199', name: 'ЕС „Красно село, бл. 199“', kind: 'etazhna_sobstvenost' },
  {
    key: 'oborishte',
    name: 'Столична община – район „Оборище“',
    kind: 'institution',
    eik: '000696327',
    billingAddress: 'София, бул. Мадрид 1',
  },
]

interface BuildingSeed {
  key: string
  customer: string
  address: Address
  lat: number
  lng: number
  contact: { name: string; phone: string; viber: boolean; email?: string }
  accessNotes?: string
}

const SOFIA = { city: 'София', oblast: 'София-град', postcode: '1000' }

const BUILDINGS: BuildingSeed[] = [
  {
    key: 'b1',
    customer: 'mladost25',
    address: { ...SOFIA, postcode: '1784', district: 'ж.к. Младост 1', block: '25', entrance: 'А' },
    lat: 42.6537,
    lng: 23.3774,
    contact: {
      name: 'Мария Петрова',
      phone: '0888 123 456',
      viber: true,
      email: 'm.petrova@example.com',
    },
    accessNotes: 'Ключ за машинното при домоуправителя, ап. 12',
  },
  {
    key: 'b2',
    customer: 'domoplus',
    address: {
      ...SOFIA,
      postcode: '1712',
      district: 'ж.к. Младост 3',
      block: '305',
      entrance: 'Б',
    },
    lat: 42.639,
    lng: 23.379,
    contact: { name: 'Георги Илиев', phone: '0887 222 333', viber: true },
  },
  {
    key: 'b3',
    customer: 'lyulin512',
    address: { ...SOFIA, postcode: '1359', district: 'ж.к. Люлин 5', block: '512', entrance: 'В' },
    lat: 42.714,
    lng: 23.259,
    contact: { name: 'Стефка Николова', phone: '0898 444 555', viber: false },
    accessNotes: 'Код на входната врата 1234#',
  },
  {
    key: 'b4',
    customer: 'domoplus',
    address: { ...SOFIA, postcode: '1324', district: 'ж.к. Люлин 7', block: '720', entrance: 'А' },
    lat: 42.708,
    lng: 23.25,
    contact: { name: 'Георги Илиев', phone: '0887 222 333', viber: true },
  },
  {
    key: 'b5',
    customer: 'domoplus',
    address: { ...SOFIA, postcode: '1592', district: 'ж.к. Дружба 1', block: '45', entrance: 'Б' },
    lat: 42.66,
    lng: 23.402,
    contact: { name: 'Петя Димова', phone: '0877 666 777', viber: true },
  },
  {
    key: 'b6',
    customer: 'domoplus',
    address: {
      ...SOFIA,
      postcode: '1220',
      district: 'ж.к. Надежда 2',
      block: '235',
      entrance: 'А',
    },
    lat: 42.725,
    lng: 23.301,
    contact: { name: 'Николай Христов', phone: '0899 888 999', viber: false },
  },
  {
    key: 'b7',
    customer: 'vitosha',
    address: { ...SOFIA, street: 'бул. Витоша', number: '100' },
    lat: 42.685,
    lng: 23.319,
    contact: {
      name: 'Рецепция',
      phone: '02 950 1234',
      viber: false,
      email: 'office@vitosha-props.example',
    },
  },
  {
    key: 'b8',
    customer: 'vitosha',
    address: { ...SOFIA, street: 'ул. Цар Асен', number: '12' },
    lat: 42.692,
    lng: 23.316,
    contact: { name: 'Елена Маринова', phone: '0888 101 202', viber: true },
  },
  {
    key: 'b9',
    customer: 'oborishte',
    address: {
      ...SOFIA,
      postcode: '1111',
      district: 'ж.к. Гео Милев',
      street: 'ул. Николай Коперник',
      number: '20',
    },
    lat: 42.679,
    lng: 23.362,
    contact: { name: 'Домакин', phone: '02 870 4455', viber: false },
  },
  {
    key: 'b10',
    customer: 'krasno199',
    address: {
      ...SOFIA,
      postcode: '1618',
      district: 'ж.к. Красно село',
      block: '199',
      entrance: 'А',
    },
    lat: 42.676,
    lng: 23.287,
    contact: { name: 'Васил Тодоров', phone: '0885 303 404', viber: true },
  },
  {
    key: 'b11',
    customer: 'krasno199',
    address: {
      ...SOFIA,
      postcode: '1618',
      district: 'ж.к. Овча купел 1',
      block: '51',
      entrance: 'Г',
    },
    lat: 42.684,
    lng: 23.256,
    contact: { name: 'Ани Стоева', phone: '0876 505 606', viber: true },
  },
  {
    key: 'b12',
    customer: 'oborishte',
    address: { ...SOFIA, postcode: '1504', street: 'ул. Оборище', number: '35' },
    lat: 42.696,
    lng: 23.338,
    contact: {
      name: 'Секретариат',
      phone: '02 815 6600',
      viber: false,
      email: 'info@oborishte.example',
    },
  },
]

interface ElevatorSeed {
  building: string
  internalNo: string
  regNo?: string
  inspectionBody?: string
  manufacturer?: string
  year?: number
  driveType?: DriveType
  doorType?: DoorType
  stops: number
  loadKg?: number
  status?: ElevatorStatus
  checkIntervalDays?: number | null
  /** Days relative to today for lastCheckAt (negative = past). Uses the effective interval: 0 => due today. */
  dueInDays: number | null
  nextInspectionInDays?: number
  alarmDevicePhone?: string
  alarmSimOperator?: string
  monthlyPriceCents: number
}

// dueInDays: 0 = due today, 1 = tomorrow, -N = overdue by N days, +N = due in N days.
const ELEVATORS: ElevatorSeed[] = [
  {
    building: 'b1',
    internalNo: 'вх. А, ляв',
    regNo: 'СФ-1001',
    inspectionBody: 'ТЕХНОТЕСТ ЕООД',
    manufacturer: 'Schindler',
    year: 1978,
    stops: 9,
    loadKg: 320,
    dueInDays: 0,
    nextInspectionInDays: 120,
    alarmDevicePhone: '0899 000 111',
    alarmSimOperator: 'A1',
    monthlyPriceCents: 5500,
  },
  {
    building: 'b1',
    internalNo: 'вх. А, десен',
    regNo: 'СФ-1002',
    inspectionBody: 'ТЕХНОТЕСТ ЕООД',
    manufacturer: 'Schindler',
    year: 1978,
    stops: 9,
    loadKg: 320,
    dueInDays: 0,
    nextInspectionInDays: 120,
    monthlyPriceCents: 5500,
  },
  {
    building: 'b2',
    internalNo: 'вх. Б',
    regNo: 'СФ-2010',
    manufacturer: 'Kone',
    year: 2009,
    doorType: 'auto',
    stops: 8,
    loadKg: 630,
    dueInDays: 1,
    nextInspectionInDays: 40,
    alarmDevicePhone: '0899 000 222',
    alarmSimOperator: 'Yettel',
    monthlyPriceCents: 6000,
  },
  {
    building: 'b3',
    internalNo: 'вх. В, ляв',
    regNo: 'СФ-3120',
    manufacturer: 'Български асансьор',
    year: 1985,
    stops: 8,
    loadKg: 320,
    checkIntervalDays: 15,
    dueInDays: -3,
    monthlyPriceCents: 5000,
  },
  {
    building: 'b3',
    internalNo: 'вх. В, десен',
    regNo: 'СФ-3121',
    manufacturer: 'Български асансьор',
    year: 1985,
    stops: 8,
    loadKg: 320,
    checkIntervalDays: 15,
    dueInDays: -3,
    monthlyPriceCents: 5000,
  },
  {
    building: 'b4',
    internalNo: 'вх. А',
    regNo: 'СФ-4001',
    manufacturer: 'Otis',
    year: 2015,
    doorType: 'auto',
    driveType: 'mrl',
    stops: 8,
    loadKg: 630,
    dueInDays: 12,
    nextInspectionInDays: 200,
    alarmDevicePhone: '0899 000 444',
    alarmSimOperator: 'Vivacom',
    monthlyPriceCents: 6500,
  },
  {
    building: 'b5',
    internalNo: 'вх. Б, ляв',
    regNo: 'СФ-5050',
    manufacturer: 'Schindler',
    year: 1982,
    stops: 9,
    loadKg: 320,
    dueInDays: -10,
    monthlyPriceCents: 5200,
  },
  {
    building: 'b5',
    internalNo: 'вх. Б, десен',
    regNo: 'СФ-5051',
    manufacturer: 'Schindler',
    year: 1982,
    stops: 9,
    loadKg: 320,
    status: 'stopped_by_firm',
    dueInDays: -40,
    monthlyPriceCents: 5200,
  },
  {
    building: 'b6',
    internalNo: 'вх. А',
    regNo: 'СФ-6006',
    manufacturer: 'Български асансьор',
    year: 1979,
    stops: 8,
    loadKg: 320,
    dueInDays: 1,
    monthlyPriceCents: 4800,
  },
  {
    building: 'b7',
    internalNo: 'пътнически',
    regNo: 'СФ-7100',
    manufacturer: 'Kone',
    year: 2018,
    driveType: 'mrl',
    doorType: 'auto',
    stops: 7,
    loadKg: 1000,
    checkIntervalDays: 30,
    dueInDays: 5,
    nextInspectionInDays: 300,
    alarmDevicePhone: '0899 000 777',
    alarmSimOperator: 'A1',
    monthlyPriceCents: 9000,
  },
  {
    building: 'b7',
    internalNo: 'товарен',
    regNo: 'СФ-7101',
    manufacturer: 'Kone',
    year: 2018,
    doorType: 'auto',
    stops: 7,
    loadKg: 1600,
    dueInDays: 5,
    nextInspectionInDays: 300,
    monthlyPriceCents: 9000,
  },
  {
    building: 'b7',
    internalNo: 'паркинг',
    regNo: 'СФ-7102',
    manufacturer: 'Kone',
    year: 2018,
    driveType: 'hydraulic',
    doorType: 'auto',
    stops: 3,
    loadKg: 2500,
    checkIntervalDays: 45,
    dueInDays: 20,
    monthlyPriceCents: 7000,
  },
  {
    building: 'b8',
    internalNo: 'централен',
    regNo: 'СФ-8012',
    manufacturer: 'Thyssen',
    year: 2005,
    doorType: 'semi_auto',
    stops: 6,
    loadKg: 450,
    dueInDays: 0,
    nextInspectionInDays: 25,
    monthlyPriceCents: 6000,
  },
  {
    building: 'b9',
    internalNo: 'ляв',
    regNo: 'СФ-9020',
    manufacturer: 'Български асансьор',
    year: 1988,
    stops: 5,
    loadKg: 320,
    checkIntervalDays: 10,
    dueInDays: -1,
    monthlyPriceCents: 4500,
  },
  {
    building: 'b9',
    internalNo: 'десен',
    regNo: 'СФ-9021',
    manufacturer: 'Български асансьор',
    year: 1988,
    stops: 5,
    loadKg: 320,
    checkIntervalDays: 10,
    dueInDays: 1,
    status: 'stopped_by_authority',
    monthlyPriceCents: 4500,
  },
  {
    building: 'b10',
    internalNo: 'вх. А',
    regNo: 'СФ-1990',
    manufacturer: 'Schindler',
    year: 1980,
    stops: 9,
    loadKg: 320,
    dueInDays: 2,
    alarmDevicePhone: '0899 000 199',
    alarmSimOperator: 'Yettel',
    monthlyPriceCents: 5500,
  },
  {
    building: 'b11',
    internalNo: 'вх. Г',
    regNo: 'СФ-1151',
    manufacturer: 'Schindler',
    year: 1984,
    stops: 9,
    loadKg: 320,
    dueInDays: 0,
    monthlyPriceCents: 5500,
  },
  {
    building: 'b12',
    internalNo: 'главен',
    regNo: 'СФ-1235',
    manufacturer: 'Otis',
    year: 2001,
    doorType: 'auto',
    stops: 5,
    loadKg: 630,
    dueInDays: 8,
    nextInspectionInDays: 60,
    monthlyPriceCents: 7500,
  },
  {
    building: 'b12',
    internalNo: 'служебен',
    manufacturer: 'Otis',
    year: 2001,
    doorType: 'semi_auto',
    stops: 5,
    loadKg: 400,
    status: 'out_of_contract',
    dueInDays: -25,
    monthlyPriceCents: 0,
  },
  {
    building: 'b6',
    internalNo: 'стар (демонтиран)',
    manufacturer: 'Български асансьор',
    year: 1979,
    stops: 8,
    status: 'scrapped',
    dueInDays: null,
    monthlyPriceCents: 0,
  },
]

const DEFAULT_INTERVAL = 30

export interface DemoElevatorRow {
  row: { id: string; buildingId: string; status: ElevatorStatus; internalNo: string }
  seed: ElevatorSeed
  interval: number
  lastCheckAt: string | null
}

export interface DemoRegistryResult {
  counts: Record<string, number>
  customerIds: Map<string, string>
  buildingIds: Map<string, string>
  elevatorRows: DemoElevatorRow[]
}

export async function ensureDemoRegistry(
  tenantId: string,
  today: string,
): Promise<DemoRegistryResult> {
  const counts: Record<string, number> = {
    customers: 0,
    contacts: 0,
    buildings: 0,
    elevators: 0,
    contracts: 0,
  }
  const customerIds = new Map<string, string>()
  for (const c of CUSTOMERS) {
    let row = await db.customer.findFirst({ where: { tenantId, name: c.name, deletedAt: null } })
    if (!row) {
      row = await db.customer.create({
        data: {
          id: newId(),
          tenantId,
          name: c.name,
          kind: c.kind,
          eik: c.eik ?? null,
          billingAddress: c.billingAddress ?? null,
        },
      })
      counts.customers!++
    }
    customerIds.set(c.key, row.id)
  }

  const buildingIds = new Map<string, string>()
  for (const b of BUILDINGS) {
    const addressText = buildAddressText(b.address)
    const customerId = customerIds.get(b.customer)!
    let row = await db.building.findFirst({ where: { tenantId, addressText, deletedAt: null } })
    if (!row) {
      row = await db.building.create({
        data: {
          id: newId(),
          tenantId,
          customerId,
          address: b.address,
          addressText,
          lat: b.lat,
          lng: b.lng,
          geocodeStatus: 'manual',
          geocodeProvider: 'seed',
          accessNotes: b.accessNotes ?? null,
        },
      })
      counts.buildings!++
    }
    buildingIds.set(b.key, row.id)
    const contact = await db.contact.findFirst({
      where: { tenantId, buildingId: row.id, name: b.contact.name, deletedAt: null },
    })
    if (!contact) {
      await db.contact.create({
        data: {
          id: newId(),
          tenantId,
          customerId,
          buildingId: row.id,
          name: b.contact.name,
          role: 'house_manager',
          phone: normalizePhone(b.contact.phone),
          hasViber: b.contact.viber,
          email: b.contact.email ?? null,
          isPrimary: true,
        },
      })
      counts.contacts!++
    }
  }

  const linesByBuilding = new Map<
    string,
    Array<{ elevatorId: string; monthlyPriceCents: number }>
  >()
  const elevatorRows: DemoElevatorRow[] = []
  for (const e of ELEVATORS) {
    const buildingId = buildingIds.get(e.building)!
    const interval = e.checkIntervalDays ?? DEFAULT_INTERVAL
    const lastCheckAt = e.dueInDays == null ? null : addDays(today, e.dueInDays - interval)
    let row = await db.elevator.findFirst({
      where: { tenantId, buildingId, internalNo: e.internalNo, deletedAt: null },
    })
    const data = {
      regNo: e.regNo ?? null,
      regNoNormalized: normalizeRegNo(e.regNo),
      inspectionBody: e.inspectionBody ?? null,
      manufacturer: e.manufacturer ?? null,
      year: e.year ?? null,
      driveType: e.driveType ?? 'electric',
      doorType: e.doorType ?? 'manual',
      stops: e.stops,
      loadKg: e.loadKg ?? null,
      status: e.status ?? 'active',
      checkIntervalDays: e.checkIntervalDays ?? null,
      lastCheckAt: fromDateOnly(lastCheckAt),
      // Demo tenant uses the rolling strategy; a re-seed drops any "move to tomorrow" override.
      nextCheckDueAt: fromDateOnly(
        nextDue({ lastCheckAt, intervalDays: interval, overrideAt: null, strategy: 'rolling' }),
      ),
      nextCheckOverrideAt: null,
      nextInspectionAt:
        e.nextInspectionInDays != null
          ? fromDateOnly(addDays(today, e.nextInspectionInDays))
          : null,
      alarmDevicePhone: normalizePhone(e.alarmDevicePhone),
      alarmSimOperator: e.alarmSimOperator ?? null,
    } as const
    if (!row) {
      row = await db.elevator.create({
        data: {
          id: newId(),
          tenantId,
          buildingId,
          internalNo: e.internalNo,
          publicCode: newPublicCode(),
          publicToken: newPublicToken(),
          ...data,
        },
      })
      counts.elevators!++
    } else {
      // Keep the due dates relative to "today" so the demo stays meaningful on every re-seed.
      row = await db.elevator.update({
        where: { id: row.id },
        data: {
          lastCheckAt: data.lastCheckAt,
          nextCheckDueAt: data.nextCheckDueAt,
          nextCheckOverrideAt: null,
          nextInspectionAt: data.nextInspectionAt,
        },
      })
    }
    elevatorRows.push({ row, seed: e, interval, lastCheckAt })
    if (
      e.monthlyPriceCents > 0 &&
      (e.status ?? 'active') !== 'out_of_contract' &&
      (e.status ?? 'active') !== 'scrapped'
    ) {
      const lines = linesByBuilding.get(e.building) ?? []
      lines.push({ elevatorId: row.id, monthlyPriceCents: e.monthlyPriceCents })
      linesByBuilding.set(e.building, lines)
    }
  }

  for (const [bKey, lines] of linesByBuilding) {
    const buildingId = buildingIds.get(bKey)!
    const b = BUILDINGS.find((x) => x.key === bKey)!
    const existing = await db.contract.findFirst({
      where: { tenantId, buildingId, status: 'active' as ContractStatus, deletedAt: null },
    })
    if (existing) continue
    const startDate = fromDateOnly(addDays(today, -400 - Math.floor(Math.random() * 300)))!
    await db.contract.create({
      data: {
        id: newId(),
        tenantId,
        customerId: customerIds.get(b.customer)!,
        buildingId,
        startDate,
        status: 'active',
        paymentDay: 10,
        lines: {
          create: lines.map((l) => ({
            id: newId(),
            tenantId,
            elevatorId: l.elevatorId,
            monthlyPriceCents: l.monthlyPriceCents,
            fromDate: startDate,
          })),
        },
      },
    })
    counts.contracts!++
  }

  return { counts, customerIds, buildingIds, elevatorRows }
}
