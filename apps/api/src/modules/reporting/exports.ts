import { createHash } from 'node:crypto'
import { PassThrough } from 'node:stream'
import * as archiverModule from 'archiver'
import type { Archiver } from 'archiver'
import type { Response } from 'express'
import type { ExportDataset, ExportJobDto } from '@avroleva/contracts'
import { EXPORT_DATASETS, EXPORT_LINK_TTL_SECONDS } from '@avroleva/contracts'
import { prismaBase } from '../../platform/db/prisma.js'
import type { Ctx } from '../../platform/http/ctx.js'
import { actorOf } from '../../platform/http/ctx.js'
import { AppError, notFound } from '../../platform/http/errors.js'
import { audit } from '../../platform/audit.js'
import { adapters } from '../../platform/adapters/index.js'
import { clock } from '../../platform/clock.js'
import { config } from '../../platform/config.js'
import { logger } from '../../platform/logger.js'
import { newId } from '../../platform/ids.js'
import { enqueue } from '../../platform/jobs/boss.js'
import { signFile, verifyFileSignature } from '../../platform/signedUrl.js'
import { urls } from '../../platform/urls.js'
import { CSV_BOM, csvLine, dateOnly } from './domain/csv.js'
import type { CsvValue } from './domain/csv.js'
import { reportNotifier } from './domain/ports.js'

/**
 * Exports (ARCHITECTURE section 5 "your data leaves with you"). `reporting` may SELECT any table
 * (ownership rule exemption), so the datasets read Prisma models directly, always scoped by
 * tenantId. CSV streams row chunks of 500; the full export builds one zip in a pg-boss job and
 * hands back a signed 24-hour link.
 */
export const FULL_EXPORT_JOB = 'exports.full'
const CHUNK = 500

// @types/archiver 8 types the classes but not the CJS factory; Node's ESM interop exposes it as `default`.
type ArchiverFactory = (format: 'zip' | 'tar', options?: { zlib?: { level: number } }) => Archiver
const archiver: ArchiverFactory =
  (archiverModule as unknown as { default?: ArchiverFactory }).default ??
  (archiverModule as unknown as ArchiverFactory)

interface Dataset {
  header: string[]
  /** Yields rows in chunks; `extra` lets a dataset widen its header from a first pass. */
  rows: (tenantId: string) => AsyncGenerator<CsvValue[][]>
  /** Optional dynamic header computed before streaming (visits: one column per checklist code). */
  prepare?: (tenantId: string) => Promise<string[]>
}

async function* paged<T extends { id: string }>(
  fetch: (cursorId: string | null) => Promise<T[]>,
): AsyncGenerator<T[]> {
  let cursor: string | null = null
  for (;;) {
    const rows = await fetch(cursor)
    if (rows.length === 0) return
    yield rows
    if (rows.length < CHUNK) return
    cursor = rows[rows.length - 1]!.id
  }
}

const pageArgs = (cursorId: string | null) => ({
  orderBy: { id: 'asc' as const },
  take: CHUNK,
  ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
})

const datasets: Record<ExportDataset, Dataset> = {
  elevators: {
    header: [
      'id',
      'internalNo',
      'regNo',
      'buildingAddressText',
      'customerName',
      'status',
      'driveType',
      'doorType',
      'goodsOnly',
      'stops',
      'loadKg',
      'manufacturer',
      'year',
      'checkIntervalDays',
      'lastCheckAt',
      'nextCheckDueAt',
      'nextCheckOverrideAt',
      'nextInspectionAt',
      'alarmDevicePhone',
      'alarmSimOperator',
      'publicCode',
      'stoppedAt',
      'stopReason',
      'notes',
      'createdAt',
      'updatedAt',
      'deletedAt',
    ],
    async *rows(tenantId) {
      for await (const rows of paged((c) =>
        prismaBase.elevator.findMany({
          where: { tenantId },
          include: {
            building: { select: { addressText: true, customer: { select: { name: true } } } },
          },
          ...pageArgs(c),
        }),
      ))
        yield rows.map((e) => [
          e.id,
          e.internalNo,
          e.regNo,
          e.building.addressText,
          e.building.customer?.name ?? '',
          e.status,
          e.driveType,
          e.doorType,
          e.goodsOnly,
          e.stops,
          e.loadKg,
          e.manufacturer,
          e.year,
          e.checkIntervalDays,
          dateOnly(e.lastCheckAt),
          dateOnly(e.nextCheckDueAt),
          dateOnly(e.nextCheckOverrideAt),
          dateOnly(e.nextInspectionAt),
          e.alarmDevicePhone,
          e.alarmSimOperator,
          e.publicCode,
          e.stoppedAt,
          e.stopReason,
          e.notes,
          e.createdAt,
          e.updatedAt,
          e.deletedAt,
        ])
    },
  },
  buildings: {
    header: [
      'id',
      'addressText',
      'address',
      'customerName',
      'lat',
      'lng',
      'geocodeStatus',
      'accessNotes',
      'keysLocation',
      'notes',
      'createdAt',
      'updatedAt',
      'deletedAt',
    ],
    async *rows(tenantId) {
      for await (const rows of paged((c) =>
        prismaBase.building.findMany({
          where: { tenantId },
          include: { customer: { select: { name: true } } },
          ...pageArgs(c),
        }),
      ))
        yield rows.map((b) => [
          b.id,
          b.addressText,
          b.address as object,
          b.customer?.name ?? '',
          b.lat,
          b.lng,
          b.geocodeStatus,
          b.accessNotes,
          b.keysLocation,
          b.notes,
          b.createdAt,
          b.updatedAt,
          b.deletedAt,
        ])
    },
  },
  customers: {
    header: [
      'id',
      'kind',
      'name',
      'eik',
      'vatNo',
      'billingAddress',
      'invoiceEmail',
      'notes',
      'createdAt',
      'updatedAt',
      'deletedAt',
    ],
    async *rows(tenantId) {
      for await (const rows of paged((c) =>
        prismaBase.customer.findMany({ where: { tenantId }, ...pageArgs(c) }),
      ))
        yield rows.map((x) => [
          x.id,
          x.kind,
          x.name,
          x.eik,
          x.vatNo,
          x.billingAddress,
          x.invoiceEmail,
          x.notes,
          x.createdAt,
          x.updatedAt,
          x.deletedAt,
        ])
    },
  },
  contacts: {
    header: [
      'id',
      'name',
      'role',
      'phone',
      'hasViber',
      'email',
      'isPrimary',
      'customerId',
      'customerName',
      'buildingId',
      'buildingAddressText',
      'notes',
      'createdAt',
      'updatedAt',
      'deletedAt',
    ],
    async *rows(tenantId) {
      for await (const rows of paged((c) =>
        prismaBase.contact.findMany({
          where: { tenantId },
          include: {
            customer: { select: { name: true } },
            building: { select: { addressText: true } },
          },
          ...pageArgs(c),
        }),
      ))
        yield rows.map((x) => [
          x.id,
          x.name,
          x.role,
          x.phone,
          x.hasViber,
          x.email,
          x.isPrimary,
          x.customerId,
          x.customer?.name ?? '',
          x.buildingId,
          x.building?.addressText ?? '',
          x.notes,
          x.createdAt,
          x.updatedAt,
          x.deletedAt,
        ])
    },
  },
  contracts: {
    header: [
      'id',
      'customerName',
      'buildingAddressText',
      'startDate',
      'endDate',
      'status',
      'paymentDay',
      'lines',
      'terminatedReason',
      'notes',
      'createdAt',
      'updatedAt',
      'deletedAt',
    ],
    async *rows(tenantId) {
      for await (const rows of paged((c) =>
        prismaBase.contract.findMany({
          where: { tenantId },
          include: {
            customer: { select: { name: true } },
            building: { select: { addressText: true } },
            lines: { include: { elevator: { select: { internalNo: true } } } },
          },
          ...pageArgs(c),
        }),
      ))
        yield rows.map((x) => [
          x.id,
          x.customer.name,
          x.building.addressText,
          dateOnly(x.startDate),
          dateOnly(x.endDate),
          x.status,
          x.paymentDay,
          x.lines
            .map((l) => `${l.elevator.internalNo}: ${(l.monthlyPriceCents / 100).toFixed(2)} EUR`)
            .join('; '),
          x.terminatedReason,
          x.notes,
          x.createdAt,
          x.updatedAt,
          x.deletedAt,
        ])
    },
  },
  visits: {
    header: [
      'id',
      'startedAt',
      'endedAt',
      'kind',
      'elevatorInternalNo',
      'buildingAddressText',
      'technicians',
      'source',
      'timestampSource',
      'clientOffsetMs',
      'qualityFlags',
      'templateKey',
      'templateVersion',
      'checklistOk',
      'checklistDefect',
      'checklistNa',
      'notes',
      'supersedesVisitId',
      'supersededAt',
      'photosPurgedAt',
      'createdAt',
    ],
    async prepare(tenantId) {
      // One column per checklist item code seen in the tenant's snapshots ("A1", "B3", ...).
      const codes = new Set<string>()
      for await (const rows of paged((c) =>
        prismaBase.visit.findMany({
          where: { tenantId, checklist: { not: { equals: null } } },
          select: { id: true, checklist: true },
          ...pageArgs(c),
        }),
      )) {
        for (const v of rows) {
          const items = (v.checklist as { items?: Array<{ code: string }> } | null)?.items ?? []
          for (const i of items) codes.add(i.code)
        }
      }
      return [...codes].sort()
    },
    async *rows(tenantId) {
      const codes = await datasets.visits.prepare!(tenantId)
      for await (const rows of paged((c) =>
        prismaBase.visit.findMany({
          where: { tenantId },
          include: {
            technicians: { orderBy: { position: 'asc' } },
            elevator: { select: { internalNo: true } },
            building: { select: { addressText: true } },
          },
          ...pageArgs(c),
        }),
      ))
        yield rows.map((v) => {
          const snap = v.checklist as {
            items?: Array<{ code: string; result: string; note: string | null }>
            summary?: { ok: number; defect: number; na: number }
          } | null
          const byCode = new Map((snap?.items ?? []).map((i) => [i.code, i]))
          return [
            v.id,
            v.startedAt,
            v.endedAt,
            v.kind,
            v.elevator.internalNo,
            v.building.addressText,
            v.technicians.map((t) => t.name).join(', '),
            v.source,
            v.timestampSource,
            v.clientOffsetMs,
            (v.qualityFlags as string[]).join(' '),
            v.templateKey,
            v.templateVersion,
            snap?.summary?.ok ?? '',
            snap?.summary?.defect ?? '',
            snap?.summary?.na ?? '',
            v.notes,
            v.supersedesVisitId,
            v.supersededAt,
            v.photosPurgedAt,
            v.createdAt,
            ...codes.map((code) => {
              const i = byCode.get(code)
              return i ? (i.note ? `${i.result}: ${i.note}` : i.result) : ''
            }),
          ]
        })
    },
  },
  callbacks: {
    header: [
      'id',
      'receivedAt',
      'channel',
      'classification',
      'trappedCount',
      'description',
      'status',
      'dispatchedAt',
      'onSiteAt',
      'releasedAt',
      'restoredAt',
      'closedAt',
      'responseMinutes',
      'slaMinutes',
      'assignedUserId',
      'elevatorInternalNo',
      'buildingAddressText',
      'callerName',
      'callerPhone',
      'cause',
      'actionTaken',
      'chargeable',
      'chargeReason',
      'notes',
      'source',
      'closeoutVisitId',
      'createdAt',
    ],
    async *rows(tenantId) {
      for await (const rows of paged((c) =>
        prismaBase.callback.findMany({
          where: { tenantId },
          include: {
            elevator: { select: { internalNo: true } },
            building: { select: { addressText: true } },
          },
          ...pageArgs(c),
        }),
      ))
        yield rows.map((x) => [
          x.id,
          x.receivedAt,
          x.channel,
          x.classification,
          x.trappedCount,
          x.description,
          x.status,
          x.dispatchedAt,
          x.onSiteAt,
          x.releasedAt,
          x.restoredAt,
          x.closedAt,
          x.onSiteAt
            ? Math.max(0, Math.floor((x.onSiteAt.getTime() - x.receivedAt.getTime()) / 60_000))
            : '',
          x.slaMinutes,
          x.assignedUserId,
          x.elevator.internalNo,
          x.building.addressText,
          x.callerName,
          x.callerPhone,
          x.cause,
          x.actionTaken,
          x.chargeable,
          x.chargeReason,
          x.notes,
          x.source,
          x.closeoutVisitId,
          x.createdAt,
        ])
    },
  },
  defects: {
    header: [
      'id',
      'recordedAt',
      'elevatorInternalNo',
      'buildingAddressText',
      'catalogCode',
      'description',
      'severity',
      'stopLift',
      'status',
      'sourceType',
      'sourceId',
      'noticeSentAt',
      'customerRequestedAt',
      'followUpDueAt',
      'resolvedAt',
      'resolvedVisitId',
      'notes',
      'createdAt',
    ],
    async *rows(tenantId) {
      for await (const rows of paged((c) =>
        prismaBase.defect.findMany({
          where: { tenantId },
          include: {
            elevator: { select: { internalNo: true } },
            building: { select: { addressText: true } },
          },
          ...pageArgs(c),
        }),
      ))
        yield rows.map((x) => [
          x.id,
          x.recordedAt,
          x.elevator.internalNo,
          x.building.addressText,
          x.catalogCode,
          x.description,
          x.severity,
          x.stopLift,
          x.status,
          x.sourceType,
          x.sourceId,
          x.noticeSentAt,
          x.customerRequestedAt,
          dateOnly(x.followUpDueAt),
          x.resolvedAt,
          x.resolvedVisitId,
          x.notes,
          x.createdAt,
        ])
    },
  },
  inspections: {
    header: [
      'id',
      'elevatorInternalNo',
      'buildingAddressText',
      'kind',
      'requestedAt',
      'scheduledAt',
      'performedAt',
      'result',
      'inspectionBody',
      'nextDueAt',
      'defects',
      'notes',
      'createdAt',
    ],
    async *rows(tenantId) {
      for await (const rows of paged((c) =>
        prismaBase.inspection.findMany({
          where: { tenantId },
          include: {
            elevator: { select: { internalNo: true, building: { select: { addressText: true } } } },
          },
          ...pageArgs(c),
        }),
      ))
        yield rows.map((x) => [
          x.id,
          x.elevator.internalNo,
          x.elevator.building.addressText,
          x.kind,
          dateOnly(x.requestedAt),
          dateOnly(x.scheduledAt),
          dateOnly(x.performedAt),
          x.result,
          x.inspectionBody,
          dateOnly(x.nextDueAt),
          x.defects as object,
          x.notes,
          x.createdAt,
        ])
    },
  },
  invoices: {
    header: [
      'id',
      'number',
      'buildingAddressText',
      'customerId',
      'contractId',
      'periodStart',
      'periodEnd',
      'issuedAt',
      'dueAt',
      'amountCents',
      'vatCents',
      'totalCents',
      'paidCents',
      'currency',
      'status',
      'paidAt',
      'voidedAt',
      'voidReason',
      'lines',
      'createdAt',
    ],
    async *rows(tenantId) {
      for await (const rows of paged((c) =>
        prismaBase.invoice.findMany({
          where: { tenantId },
          include: { building: { select: { addressText: true } } },
          ...pageArgs(c),
        }),
      ))
        yield rows.map((x) => [
          x.id,
          x.number,
          x.building.addressText,
          x.customerId,
          x.contractId,
          dateOnly(x.periodStart),
          dateOnly(x.periodEnd),
          dateOnly(x.issuedAt),
          dateOnly(x.dueAt),
          x.amountCents,
          x.vatCents,
          x.totalCents,
          x.paidCents,
          x.currency,
          x.status,
          dateOnly(x.paidAt),
          x.voidedAt,
          x.voidReason,
          x.lines as object,
          x.createdAt,
        ])
    },
  },
  payments: {
    header: [
      'id',
      'invoiceId',
      'invoiceNumber',
      'buildingAddressText',
      'amountCents',
      'paidAt',
      'method',
      'note',
      'createdByUserId',
      'createdAt',
    ],
    async *rows(tenantId) {
      for await (const rows of paged((c) =>
        prismaBase.payment.findMany({
          where: { tenantId },
          include: {
            invoice: { select: { number: true } },
            building: { select: { addressText: true } },
          },
          ...pageArgs(c),
        }),
      ))
        yield rows.map((x) => [
          x.id,
          x.invoiceId,
          x.invoice?.number ?? '',
          x.building.addressText,
          x.amountCents,
          dateOnly(x.paidAt),
          x.method,
          x.note,
          x.createdByUserId,
          x.createdAt,
        ])
    },
  },
  notifications: {
    header: [
      'id',
      'createdAt',
      'eventType',
      'channel',
      'to',
      'userId',
      'subject',
      'status',
      'providerId',
      'error',
      'relatedType',
      'relatedId',
      'attempts',
      'sentAt',
      'readAt',
    ],
    async *rows(tenantId) {
      for await (const rows of paged((c) =>
        prismaBase.notification.findMany({ where: { tenantId }, ...pageArgs(c) }),
      ))
        yield rows.map((x) => [
          x.id,
          x.createdAt,
          x.eventType,
          x.channel,
          x.to,
          x.userId,
          x.subject,
          x.status,
          x.providerId,
          x.error,
          x.relatedType,
          x.relatedId,
          x.attempts,
          x.sentAt,
          x.readAt,
        ])
    },
  },
  audit: {
    header: [
      'id',
      'at',
      'actorType',
      'actorId',
      'action',
      'entityType',
      'entityId',
      'before',
      'after',
      'requestId',
      'ip',
    ],
    async *rows(tenantId) {
      let cursor: bigint | null = null
      for (;;) {
        const rows: Array<{
          id: bigint
          at: Date
          actorType: string
          actorId: string | null
          action: string
          entityType: string
          entityId: string | null
          before: unknown
          after: unknown
          requestId: string | null
          ip: string | null
        }> = await prismaBase.auditLog.findMany({
          where: { tenantId, ...(cursor !== null ? { id: { gt: cursor } } : {}) },
          orderBy: { id: 'asc' },
          take: CHUNK,
        })
        if (rows.length === 0) return
        yield rows.map((x) => [
          x.id.toString(),
          x.at,
          x.actorType,
          x.actorId,
          x.action,
          x.entityType,
          x.entityId,
          x.before as object,
          x.after as object,
          x.requestId,
          x.ip,
        ])
        if (rows.length < CHUNK) return
        cursor = rows[rows.length - 1]!.id
      }
    },
  },
}

export function isDataset(name: string): name is ExportDataset {
  return (EXPORT_DATASETS as readonly string[]).includes(name)
}

/** Streams one dataset as CSV (BOM + header + rows) into an Express response. */
export async function streamCsv(ctx: Ctx, dataset: ExportDataset, res: Response): Promise<number> {
  const def = datasets[dataset]
  const extra = def.prepare ? await def.prepare(ctx.tenantId) : []
  res.status(200)
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${dataset}.csv"`)
  res.setHeader('Cache-Control', 'no-store')
  res.write(CSV_BOM + csvLine([...def.header, ...extra]))
  let count = 0
  for await (const chunk of def.rows(ctx.tenantId)) {
    for (const row of chunk) res.write(csvLine(row))
    count += chunk.length
  }
  res.end()
  await audit(actorOf(ctx), {
    action: 'export.csv',
    entityType: 'export',
    entityId: dataset,
    after: { rows: count },
  })
  return count
}

/** Whole dataset as one string (full export). */
export async function datasetToCsv(
  tenantId: string,
  dataset: ExportDataset,
): Promise<{ csv: string; rows: number }> {
  const def = datasets[dataset]
  const extra = def.prepare ? await def.prepare(tenantId) : []
  let out = CSV_BOM + csvLine([...def.header, ...extra])
  let rows = 0
  for await (const chunk of def.rows(tenantId)) {
    for (const row of chunk) out += csvLine(row)
    rows += chunk.length
  }
  return { csv: out, rows }
}

// ---- Full export job ---------------------------------------------------------------------------

export function exportStorageKey(tenantId: string, jobId: string): string {
  return `exports/${tenantId}/${jobId}.zip`
}

function signedExportUrl(id: string, tenantId: string, exp: number): string {
  const sig = signFile(`export:${id}`, 'full', exp, tenantId)
  const base = config.BASE_PATH === '/' ? '' : config.BASE_PATH
  return `${base}/files/export/${id}?exp=${exp}&sig=${sig}`
}

export function verifyExportSignature(
  id: string,
  tenantId: string,
  exp: number,
  sig: string,
): boolean {
  return verifyFileSignature(`export:${id}`, 'full', exp, tenantId, sig)
}

export function toExportJobDto(
  j: {
    id: string
    kind: string
    status: 'queued' | 'running' | 'done' | 'failed'
    requestedByUserId: string | null
    bytes: number | null
    summary: unknown
    error: string | null
    createdAt: Date
    finishedAt: Date | null
    expiresAt: Date | null
    tenantId: string
  },
  requestedByName: string | null = null,
): ExportJobDto {
  const now = clock.now()
  const live = j.status === 'done' && j.expiresAt !== null && j.expiresAt.getTime() > now.getTime()
  return {
    id: j.id,
    kind: 'full',
    status: j.status,
    requestedByUserId: j.requestedByUserId,
    requestedByName,
    bytes: j.bytes,
    error: j.error,
    createdAt: j.createdAt.toISOString(),
    finishedAt: j.finishedAt ? j.finishedAt.toISOString() : null,
    expiresAt: j.expiresAt ? j.expiresAt.toISOString() : null,
    downloadUrl: live
      ? signedExportUrl(j.id, j.tenantId, Math.floor(j.expiresAt!.getTime() / 1000))
      : null,
    summary: (j.summary as Record<string, number> | null) ?? null,
  }
}

export async function requestFullExport(ctx: Ctx): Promise<ExportJobDto> {
  if (ctx.role === 'technician') throw new AppError(403, 'auth.forbidden')
  const running = await prismaBase.exportJob.count({
    where: { tenantId: ctx.tenantId, status: { in: ['queued', 'running'] } },
  })
  if (running > 0) throw new AppError(409, 'exports.alreadyRunning')
  const row = await prismaBase.exportJob.create({
    data: { id: newId(), tenantId: ctx.tenantId, kind: 'full', requestedByUserId: ctx.userId },
  })
  await audit(actorOf(ctx), {
    action: 'export.full.request',
    entityType: 'export_job',
    entityId: row.id,
  })
  await enqueue(
    FULL_EXPORT_JOB,
    { id: row.id, tenantId: ctx.tenantId },
    { singletonKey: `export:${row.id}` },
  )
  return toExportJobDto(row)
}

export async function listExports(ctx: Ctx): Promise<ExportJobDto[]> {
  const rows = await prismaBase.exportJob.findMany({
    where: { tenantId: ctx.tenantId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
  const userIds = [...new Set(rows.map((r) => r.requestedByUserId).filter((x): x is string => !!x))]
  const users = userIds.length
    ? await prismaBase.user.findMany({
        where: { tenantId: ctx.tenantId, id: { in: userIds } },
        select: { id: true, name: true },
      })
    : []
  const names = new Map(users.map((u) => [u.id, u.name]))
  return rows.map((r) =>
    toExportJobDto(r, r.requestedByUserId ? (names.get(r.requestedByUserId) ?? null) : null),
  )
}

/** Bytes for the signed download route (null = unknown id / expired / file gone). */
export async function readExport(
  id: string,
  exp: number,
  sig: string,
): Promise<{ bytes: Buffer; filename: string } | null> {
  const row = await prismaBase.exportJob.findUnique({ where: { id } })
  if (!row || row.status !== 'done' || !row.storageKey) return null
  if (!verifyExportSignature(id, row.tenantId, exp, sig)) return null
  if (row.expiresAt && row.expiresAt.getTime() < clock.now().getTime()) return null
  const f = await adapters.storage.get(row.storageKey)
  if (!f) return null
  return {
    bytes: f.bytes,
    filename: `avroleva-export-${row.createdAt.toISOString().slice(0, 10)}.zip`,
  }
}

/** Storage keys of a tenant's export zips (tenant purge). */
export async function exportStorageKeys(tenantId: string): Promise<string[]> {
  const rows = await prismaBase.exportJob.findMany({
    where: { tenantId, storageKey: { not: null } },
    select: { storageKey: true },
  })
  return rows.map((r) => r.storageKey!).filter(Boolean)
}

function readme(tenantName: string, generatedAt: string, summary: Record<string, number>): string {
  const lines = Object.entries(summary)
    .map(([k, v]) => `  ${k}: ${v}`)
    .join('\n')
  return `AVROLEVA ELEVATORS – ПЪЛЕН ЕКСПОРТ НА ДАННИТЕ / FULL DATA EXPORT
Фирма / Firm: ${tenantName}
Генериран на / Generated at: ${generatedAt}

BG
Този архив съдържа всички данни на фирмата, така както са записани в Avroleva Elevators:
- csv/<набор>.csv – по един файл за всяка таблица (UTF-8 с BOM, разделител запетая; отваря се
  директно в Excel / LibreOffice). Парите са в евроцентове (amountCents = 1234 → 12,34 EUR).
  Датите са в ISO формат (UTC за момент, ГГГГ-ММ-ДД за дата).
- csv/visits.csv – посещенията с резултатите от списъка за проверка: по една колона за всяка
  точка (напр. A1, B3) със стойност ok / defect / na и бележката след двоеточие.
- photos/<id на посещение>/<id>.jpg – снимките, групирани по посещение.
- csv/audit.csv – журналът на действията (кой, кога, какво), само за четене.
- manifest.json – SHA-256 на всеки файл в архива, за проверка на целостта.
Хартиеният дневник остава законовият документ; този експорт е записът на офиса.

EN
This archive contains every record of the firm as stored in Avroleva Elevators:
- csv/<dataset>.csv – one file per table (UTF-8 with BOM, comma separated; opens directly in
  Excel / LibreOffice). Money is in euro cents (amountCents = 1234 → 12.34 EUR). Dates are ISO
  (UTC for instants, YYYY-MM-DD for dates).
- csv/visits.csv – visits with the checklist results flattened: one column per item code (e.g. A1,
  B3) holding ok / defect / na and the note after a colon.
- photos/<visit id>/<id>.jpg – photos grouped by visit.
- csv/audit.csv – the action log (who, when, what), read-only.
- manifest.json – SHA-256 of every file in the archive, for integrity checks.

Row counts / Брой редове:
${lines}
`
}

/** The pg-boss handler: builds the zip, stores it, notifies the requester (in-app + e-mail). */
export async function runFullExport(
  tenantId: string,
  jobId: string,
): Promise<Record<string, number>> {
  const job = await prismaBase.exportJob.findFirst({ where: { id: jobId, tenantId } })
  if (!job || job.status === 'done') return {}
  const startedAt = clock.now()
  await prismaBase.exportJob.update({
    where: { id: jobId },
    data: { status: 'running', startedAt },
  })
  try {
    const tenant = await prismaBase.tenant.findUnique({ where: { id: tenantId } })
    if (!tenant) throw new Error('tenant not found')
    const archive = archiver('zip', { zlib: { level: 6 } })
    const sink = new PassThrough()
    const chunks: Buffer[] = []
    sink.on('data', (c: Buffer) => chunks.push(c))
    const done = new Promise<void>((resolve, reject) => {
      sink.on('finish', resolve)
      archive.on('error', reject)
    })
    archive.pipe(sink)
    const manifest: Record<string, string> = {}
    const summary: Record<string, number> = {}
    const add = (name: string, content: Buffer | string) => {
      const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8')
      manifest[name] = createHash('sha256').update(buf).digest('hex')
      archive.append(buf, { name })
    }
    for (const ds of EXPORT_DATASETS) {
      const { csv, rows } = await datasetToCsv(tenantId, ds)
      summary[ds] = rows
      add(`csv/${ds}.csv`, csv)
    }
    // Photos grouped by visit; unlinked ones under photos/unlinked.
    const links = await prismaBase.visitAttachment.findMany({
      where: { tenantId },
      select: { visitId: true, attachmentId: true },
    })
    const byAttachment = new Map(links.map((l) => [l.attachmentId, l.visitId]))
    let photos = 0
    for await (const rows of paged((c) =>
      prismaBase.attachment.findMany({
        where: { tenantId },
        select: { id: true, storageKey: true },
        ...pageArgs(c),
      }),
    )) {
      for (const a of rows) {
        const f = await adapters.storage.get(a.storageKey)
        if (!f) continue
        add(`photos/${byAttachment.get(a.id) ?? 'unlinked'}/${a.id}.jpg`, f.bytes)
        photos++
      }
    }
    summary.photos = photos
    add('README.txt', readme(tenant.name, startedAt.toISOString(), summary))
    add('manifest.json', JSON.stringify(manifest, null, 2))
    await archive.finalize()
    await done
    const zip = Buffer.concat(chunks)
    const key = exportStorageKey(tenantId, jobId)
    await adapters.storage.put(key, zip, 'application/zip')
    const finishedAt = clock.now()
    const expiresAt = new Date(finishedAt.getTime() + EXPORT_LINK_TTL_SECONDS * 1000)
    await prismaBase.exportJob.update({
      where: { id: jobId },
      data: { status: 'done', storageKey: key, bytes: zip.length, summary, finishedAt, expiresAt },
    })
    await audit(
      { tenantId, actorType: 'system', actorId: null, requestId: 'exports.full' },
      {
        action: 'export.full.done',
        entityType: 'export_job',
        entityId: jobId,
        after: { bytes: zip.length, summary },
      },
    )
    const sizeLabel = `${(zip.length / (1024 * 1024)).toFixed(1)} MB`
    const url = `${urls.base()}${signedExportUrl(jobId, tenantId, Math.floor(expiresAt.getTime() / 1000))}`
    const data = { export: { sizeLabel, url } }
    if (job.requestedByUserId) {
      const n = reportNotifier()
      await n.notifyUsers(tenantId, {
        key: 'export_ready',
        userIds: [job.requestedByUserId],
        data,
        relatedType: 'export_job',
        relatedId: jobId,
        link: '/settings/data',
      })
      await n.notifyUsers(tenantId, {
        key: 'export_ready',
        userIds: [job.requestedByUserId],
        data,
        relatedType: 'export_job',
        relatedId: jobId,
        channel: 'email',
      })
    }
    return summary
  } catch (err) {
    logger.error({ err, jobId, tenantId }, 'full export failed')
    await prismaBase.exportJob.update({
      where: { id: jobId },
      data: {
        status: 'failed',
        error: String((err as Error)?.message ?? err).slice(0, 1000),
        finishedAt: clock.now(),
      },
    })
    throw err
  }
}

export async function getExport(ctx: Ctx, id: string): Promise<ExportJobDto> {
  const row = await prismaBase.exportJob.findFirst({ where: { id, tenantId: ctx.tenantId } })
  if (!row) throw notFound()
  return toExportJobDto(row)
}
