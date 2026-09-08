import { prismaBase as db } from '../../src/platform/db/prisma.js'
import { newId, newPublicCode, newPublicToken } from '../../src/platform/ids.js'
import { addDays, fromDateOnly, todayInSofia } from '../../src/platform/clock.js'
import { createT } from '../../src/platform/i18n.js'
import type { Ctx } from '../../src/platform/http/ctx.js'
import { hashPassword } from '../../src/modules/tenancy/index.js'
import {
  buildAddressText,
  normalizePhone,
  normalizeRegNo,
  useScheduleRules,
} from '../../src/modules/registry/index.js'
import { nextDue, scheduleRules } from '../../src/modules/maintenance/index.js'
import * as billing from '../../src/modules/billing/index.js'
import { seedStep3 } from './step3.js'
import { seedStep4 } from './step4.js'
import { seedStep5 } from './step5.js'

useScheduleRules(scheduleRules)
import type {
  ContractStatus,
  CustomerKind,
  DoorType,
  DriveType,
  ElevatorStatus,
} from '../../src/generated/prisma/index.js'
import type { Address } from '@avroleva/contracts'

export const DEMO = {
  tenant: { name: 'Демо Лифт Сервиз', eik: '200000001' },
  users: [
    { username: 'demo', password: 'demo1234', name: 'Димитър Стоянов', role: 'owner' as const },
    { username: 'maria', password: 'demo1234', name: 'Мария Георгиева', role: 'office' as const },
    { username: 'ivan', password: 'demo1234', name: 'Иван Петров', role: 'technician' as const },
  ],
}

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

export async function seedDemoTenant(): Promise<Record<string, number>> {
  const today = todayInSofia()
  const counts: Record<string, number> = {
    users: 0,
    customers: 0,
    contacts: 0,
    buildings: 0,
    elevators: 0,
    contracts: 0,
    visits: 0,
    invoices: 0,
    payments: 0,
  }

  let tenant = await db.tenant.findFirst({ where: { eik: DEMO.tenant.eik } })
  if (!tenant) {
    tenant = await db.tenant.create({
      data: {
        id: newId(),
        name: DEMO.tenant.name,
        eik: DEMO.tenant.eik,
        address: 'София, ул. Индустриална 11',
        phone: '02 999 1234',
        emergencyPhone: '0700 12 345',
        email: 'office@demolift.example',
        locale: 'bg',
        settings: {
          checkIntervalDays: DEFAULT_INTERVAL,
          cycleStrategy: 'rolling',
          callbackSlaMinutes: 60,
          defectFollowUpDays: 30,
          showBgnReference: true,
          currencyDisplay: 'EUR_BGN',
        },
      },
    })
  }
  const tenantId = tenant.id

  for (const u of DEMO.users) {
    const existing = await db.user.findUnique({ where: { username: u.username } })
    if (!existing) {
      await db.user.create({
        data: {
          id: newId(),
          tenantId,
          username: u.username,
          passwordHash: await hashPassword(u.password),
          name: u.name,
          role: u.role,
          phone: null,
        },
      })
      counts.users!++
    }
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
  const elevatorRows: Array<{
    row: { id: string; buildingId: string; status: ElevatorStatus }
    seed: ElevatorSeed
    interval: number
    lastCheckAt: string | null
  }> = []
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

  counts.visits = await seedVisits(tenantId, elevatorRows, today)
  const billing = await seedBilling(tenantId, buildingIds, today)
  counts.invoices = billing.invoices
  counts.payments = billing.payments
  const step3 = await seedStep3(
    tenantId,
    elevatorRows.map((r) => ({
      id: r.row.id,
      buildingId: r.row.buildingId,
      internalNo: r.seed.internalNo,
      status: r.row.status,
    })),
    today,
  )
  Object.assign(counts, step3)
  Object.assign(counts, await seedStep4(tenantId))
  Object.assign(counts, await seedStep5(tenantId))

  return { ...counts, tenantIdKnown: 1 }
}

// ---------------------------------------------------------------- visit history

const TECHNICIANS = ['Иван Петров', 'Петър Иванов', 'Георги Димитров', 'Стоян Колев']
const REPAIR_NOTES = [
  'Смяна на ролки на кабинните врати.',
  'Регулиране на спирачката; проверка на въжетата.',
  'Подмяна на бутон на етажен пост, 3 ет.',
  'Почистване на шахтата и смазване на водачите.',
  'Смяна на осветление в кабината.',
]

/**
 * 6-18 months of visits per elevator, walking backwards from lastCheckAt at the elevator's
 * interval (with a little jitter), mostly functional checks, every 4th a technical maintenance
 * and the odd repair. Idempotent: an elevator that already has visits only gets a check visit on
 * its (re-seeded, today-relative) lastCheckAt when the newest visit is older than that.
 */
async function seedVisits(
  tenantId: string,
  rows: Array<{
    row: { id: string; buildingId: string }
    interval: number
    lastCheckAt: string | null
  }>,
  today: string,
): Promise<number> {
  let created = 0
  const ivan = await db.user.findUnique({ where: { username: 'ivan' }, select: { id: true } })
  const userIdByName = new Map<string, string>()
  if (ivan) userIdByName.set('Иван Петров', ivan.id)

  for (const [i, r] of rows.entries()) {
    if (!r.lastCheckAt) continue
    const existing = await db.visit.count({ where: { tenantId, elevatorId: r.row.id } })
    const latest = existing
      ? await db.visit.findFirst({
          where: { tenantId, elevatorId: r.row.id },
          orderBy: { startedAt: 'desc' },
          select: { startedAt: true },
        })
      : null
    const monthsBack = 6 + ((i * 7) % 13) // 6..18
    const horizon = addDays(r.lastCheckAt, -Math.round(monthsBack * 30.4))
    const pair = [TECHNICIANS[i % 4]!, TECHNICIANS[(i + 1) % 4]!]

    let date = r.lastCheckAt
    let n = 0
    while (date >= horizon && date <= today) {
      if (latest && new Date(date + 'T00:00:00Z') <= latest.startedAt) break
      const kind = n % 4 === 3 ? 'technical_maintenance' : 'functional_check'
      const startedAt = new Date(
        `${date}T${String(8 + ((i + n) % 9)).padStart(2, '0')}:${n % 2 ? '30' : '00'}:00+03:00`,
      )
      const endedAt = new Date(
        startedAt.getTime() + (kind === 'functional_check' ? 25 : 55) * 60_000,
      )
      const techs = n % 5 === 4 ? [pair[0]!] : pair
      await db.visit.create({
        data: {
          id: newId(),
          tenantId,
          elevatorId: r.row.id,
          buildingId: r.row.buildingId,
          kind,
          startedAt,
          endedAt,
          notes: kind === 'technical_maintenance' ? 'Планово техническо обслужване.' : null,
          source: 'paper',
          qualityFlags: techs.length < 2 ? ['singleTechnician'] : [],
          technicians: {
            create: techs.map((name, p) => ({
              id: newId(),
              tenantId,
              userId: userIdByName.get(name) ?? null,
              position: p + 1,
              name,
            })),
          },
        },
      })
      created++
      // An occasional repair a few days after a check.
      if ((i + n) % 7 === 6) {
        const repairDay = addDays(date, 3)
        if (repairDay <= today) {
          const at = new Date(`${repairDay}T14:00:00+03:00`)
          await db.visit.create({
            data: {
              id: newId(),
              tenantId,
              elevatorId: r.row.id,
              buildingId: r.row.buildingId,
              kind: 'repair',
              startedAt: at,
              endedAt: new Date(at.getTime() + 90 * 60_000),
              notes: REPAIR_NOTES[(i + n) % REPAIR_NOTES.length]!,
              source: 'paper',
              qualityFlags: [],
              technicians: {
                create: [{ id: newId(), tenantId, userId: null, position: 1, name: pair[1]! }],
              },
            },
          })
          created++
        }
      }
      n++
      date = addDays(date, -(r.interval + ((n % 3) - 1)))
    }
  }
  return created
}

// ---------------------------------------------------------------- invoices & payments

/**
 * Invoices for the last 6 months for every active contract through the billing module (gapless
 * numbering, idempotent per contract+period), then a realistic mix: older months paid, a few
 * buildings behind (overdue), the current month mostly pending, plus two unallocated payments.
 */
async function seedBilling(
  tenantId: string,
  buildingIds: Map<string, string>,
  today: string,
): Promise<{ invoices: number; payments: number }> {
  const owner = await db.user.findUnique({ where: { username: 'demo' }, select: { id: true } })
  if (!owner) return { invoices: 0, payments: 0 }
  const ctx: Ctx = {
    tenantId,
    userId: owner.id,
    role: 'owner',
    sessionId: 'seed',
    requestId: 'seed',
    locale: 'bg',
    t: createT('bg'),
  }
  const periods: string[] = []
  for (let k = 5; k >= 0; k--) periods.push(addMonthsToPeriod(today.slice(0, 7), -k))
  let invoices = 0
  for (const p of periods) invoices += (await billing.generate(ctx, p)).created

  const keyOfBuilding = new Map([...buildingIds.entries()].map(([k, v]) => [v, k]))
  const behind = new Set(['b3', 'b5', 'b9']) // overdue for the previous 1-2 months
  const early = new Set(['b7', 'b12']) // already paid the current month
  let payments = 0
  const all = await billing.list(ctx, { limit: 200 })
  for (const inv of all.items) {
    if (inv.status === 'paid' || inv.status === 'void') continue
    const key = keyOfBuilding.get(inv.buildingId) ?? 'b1'
    const idx = Number(key.slice(1))
    const k = periods.indexOf(inv.period) // 0 = oldest, 5 = current month
    let pay = false
    if (k <= 2) pay = true
    else if (k === 3) pay = !behind.has(key) || key === 'b9'
    else if (k === 4) pay = !behind.has(key)
    else pay = early.has(key)
    if (!pay) continue
    const paidAt = addDays(inv.dueAt, (idx % 5) - 2)
    await billing.pay(ctx, inv.id, {
      paidAt: paidAt > today ? today : paidAt,
      method: idx % 3 === 0 ? 'cash' : 'bank',
      note: null,
    })
    payments++
  }
  // Two unallocated payments (advance / rounding), only once.
  const extra = [
    { key: 'b1', amountCents: 2000, method: 'cash' as const, note: 'Аванс от домоуправителя' },
    { key: 'b7', amountCents: 10000, method: 'bank' as const, note: 'Превод без посочена фактура' },
  ]
  for (const x of extra) {
    const buildingId = buildingIds.get(x.key)!
    const exists = await db.payment.findFirst({ where: { tenantId, buildingId, invoiceId: null } })
    if (exists) continue
    await billing.createPayment(ctx, {
      buildingId,
      amountCents: x.amountCents,
      paidAt: addDays(today, -4),
      method: x.method,
      note: x.note,
    })
    payments++
  }
  return { invoices, payments }
}

function addMonthsToPeriod(period: string, months: number): string {
  const [y, m] = period.split('-').map(Number) as [number, number]
  const d = new Date(Date.UTC(y, m - 1 + months, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
