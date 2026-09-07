import type { ImportBatchDto, ImportPreviewRow, ImportRowIssue } from '@avroleva/contracts'
import { IMPORT_COLUMNS } from '@avroleva/contracts'
import type { Ctx } from '../../../platform/http/ctx.js'
import { actorOf } from '../../../platform/http/ctx.js'
import { AppError, notFound } from '../../../platform/http/errors.js'
import { audit } from '../../../platform/audit.js'
import { fromDateOnly } from '../../../platform/clock.js'
import { events } from '../../../platform/events/bus.js'
import { transaction } from '../../../platform/db/prisma.js'
import type { Tx } from '../../../platform/db/prisma.js'
import * as imports from '../repo/imports.js'
import * as customers from '../repo/customers.js'
import * as contacts from '../repo/contacts.js'
import * as buildings from '../repo/buildings.js'
import * as elevators from '../repo/elevators.js'
import * as contracts from '../repo/contracts.js'
import { parseImport, templateExampleRows } from '../domain/import.js'
import { toCsv } from '../domain/csv.js'
import { toImportBatchDto } from '../domain/mappers.js'
import { normalizeRegNo } from '../domain/address.js'

export function templateCsv(): string {
  return toCsv([[...IMPORT_COLUMNS], ...templateExampleRows], ';')
}

export async function preview(ctx: Ctx, filename: string, csv: string): Promise<ImportBatchDto> {
  const parsed = parseImport(csv)
  const issues: ImportRowIssue[] = [...parsed.issues]
  for (const h of parsed.unknownHeaders) {
    issues.push({
      row: 0,
      column: h,
      code: 'import.unknownColumn',
      message: 'import.unknownColumn',
      level: 'warning',
    })
  }
  const batch = await imports.createBatch(ctx.tenantId, {
    filename,
    rowCount: parsed.rows.length,
    issues: issues as unknown as object[],
    rows: parsed.rows as unknown as object[],
    createdBy: ctx.userId,
  })
  return toImportBatchDto(batch)
}

export async function get(ctx: Ctx, id: string): Promise<ImportBatchDto> {
  const b = await imports.findBatch(ctx.tenantId, id)
  if (!b) throw notFound()
  return toImportBatchDto(b)
}

export async function list(ctx: Ctx): Promise<ImportBatchDto[]> {
  return (await imports.listBatches(ctx.tenantId)).map((b) => ({
    ...toImportBatchDto(b),
    rows: [],
  }))
}

interface Created {
  customers: number
  contacts: number
  buildings: number
  elevators: number
  contracts: number
  ids: {
    customers: string[]
    contacts: string[]
    buildings: string[]
    elevators: string[]
    contracts: string[]
  }
}

/** Commits a previewed batch: customers/buildings are matched by name/address, elevators are created. */
export async function commit(ctx: Ctx, id: string): Promise<ImportBatchDto> {
  const batch = await imports.findBatch(ctx.tenantId, id)
  if (!batch) throw notFound()
  if (batch.status !== 'preview') throw new AppError(409, 'import.alreadyCommitted')
  const issues = (batch.issues as unknown as ImportRowIssue[]) ?? []
  if (issues.some((i) => i.level === 'error')) throw new AppError(409, 'import.hasErrors')
  const rows = (batch.rows as unknown as ImportPreviewRow[]) ?? []

  const created: Created = {
    customers: 0,
    contacts: 0,
    buildings: 0,
    elevators: 0,
    contracts: 0,
    ids: { customers: [], contacts: [], buildings: [], elevators: [], contracts: [] },
  }
  const elevatorIds: string[] = []

  const result = await transaction(async (tx) => {
    const customerCache = new Map<string, string>()
    const buildingCache = new Map<string, string>()
    const contractPending = new Map<
      string,
      {
        customerId: string
        buildingId: string
        start: Date
        lines: { elevatorId: string; monthlyPriceCents: number }[]
      }
    >()

    for (const r of rows) {
      const customerId = await ensureCustomer(ctx, tx, r, customerCache, created)
      const buildingId = await ensureBuilding(ctx, tx, r, customerId, buildingCache, created)
      if (r.contactName && !buildingCache.has('contact:' + buildingId)) {
        const c = await contacts.createContact(
          ctx.tenantId,
          {
            customerId,
            buildingId,
            name: r.contactName,
            role: 'house_manager',
            phone: r.contactPhone,
            hasViber: r.contactViber,
            email: r.contactEmail,
            isPrimary: true,
          },
          tx,
        )
        created.contacts++
        created.ids.contacts.push(c.id)
        buildingCache.set('contact:' + buildingId, c.id)
      }
      const e = await elevators.createElevator(
        ctx.tenantId,
        {
          buildingId,
          internalNo: r.internalNo,
          regNo: r.regNo,
          regNoNormalized: normalizeRegNo(r.regNo),
          inspectionBody: r.inspectionBody,
          manufacturer: r.manufacturer,
          year: r.year,
          driveType: r.driveType,
          doorType: r.doorType,
          stops: r.stops,
          loadKg: r.loadKg,
          status: 'active',
          lastCheckAt: fromDateOnly(r.lastCheckAt),
          nextInspectionAt: fromDateOnly(r.nextInspectionAt),
          alarmDevicePhone: r.alarmDevicePhone,
          alarmSimOperator: r.alarmSimOperator,
          createdBy: ctx.userId,
        },
        tx,
      )
      created.elevators++
      created.ids.elevators.push(e.id)
      elevatorIds.push(e.id)
      if (r.monthlyPriceCents != null) {
        const key = buildingId
        const start = fromDateOnly(r.contractStart) ?? new Date()
        const p = contractPending.get(key) ?? { customerId, buildingId, start, lines: [] }
        p.lines.push({ elevatorId: e.id, monthlyPriceCents: r.monthlyPriceCents })
        contractPending.set(key, p)
      }
    }

    for (const p of contractPending.values()) {
      const existing = await contracts.findActiveContractForBuilding(ctx.tenantId, p.buildingId, tx)
      if (existing) {
        await contracts.addLines(ctx.tenantId, existing.id, p.lines, p.start, tx)
      } else {
        const c = await contracts.createContract(
          ctx.tenantId,
          {
            customerId: p.customerId,
            buildingId: p.buildingId,
            startDate: p.start,
            status: 'active',
            createdBy: ctx.userId,
          },
          p.lines,
          tx,
        )
        created.contracts++
        created.ids.contracts.push(c.id)
      }
    }

    const updated = await imports.setBatchStatus(
      ctx.tenantId,
      id,
      'committed',
      created as unknown as object,
      tx,
    )
    await audit(
      actorOf(ctx),
      {
        action: 'import.commit',
        entityType: 'import_batch',
        entityId: id,
        after: { ...created, ids: undefined },
      },
      tx,
    )
    return updated
  })

  for (const eid of elevatorIds) {
    await events.publish(ctx, {
      type: 'ElevatorRegistered',
      aggregateType: 'elevator',
      aggregateId: eid,
      payload: { source: 'import', batchId: id },
    })
  }
  return toImportBatchDto(result)
}

async function ensureCustomer(
  ctx: Ctx,
  tx: Tx,
  r: ImportPreviewRow,
  cache: Map<string, string>,
  created: Created,
): Promise<string> {
  const key = r.customerName.trim().toLowerCase()
  const cached = cache.get(key)
  if (cached) return cached
  const existing = await customers.findCustomerByName(ctx.tenantId, r.customerName, tx)
  if (existing) {
    cache.set(key, existing.id)
    return existing.id
  }
  const c = await customers.createCustomer(
    ctx.tenantId,
    { name: r.customerName, kind: r.customerKind, createdBy: ctx.userId },
    tx,
  )
  created.customers++
  created.ids.customers.push(c.id)
  cache.set(key, c.id)
  return c.id
}

async function ensureBuilding(
  ctx: Ctx,
  tx: Tx,
  r: ImportPreviewRow,
  customerId: string,
  cache: Map<string, string>,
  created: Created,
): Promise<string> {
  const key = r.addressText.trim().toLowerCase()
  const cached = cache.get(key)
  if (cached) return cached
  const existing = await buildings.findBuildingByAddressText(ctx.tenantId, r.addressText, tx)
  if (existing) {
    cache.set(key, existing.id)
    return existing.id
  }
  const hasCoords = r.lat != null && r.lng != null
  const b = await buildings.createBuilding(
    ctx.tenantId,
    {
      customerId,
      address: r.address,
      addressText: r.addressText,
      lat: hasCoords ? r.lat : null,
      lng: hasCoords ? r.lng : null,
      geocodeStatus: hasCoords ? 'manual' : 'pending',
      createdBy: ctx.userId,
    },
    tx,
  )
  created.buildings++
  created.ids.buildings.push(b.id)
  cache.set(key, b.id)
  return b.id
}
