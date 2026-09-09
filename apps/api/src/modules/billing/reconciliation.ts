import type {
  BankCsvMapping,
  BankCsvPresetDto,
  BankImportCommitResultDto,
  BankImportDto,
  BankImportPreviewBody,
  BankImportRowDto,
  MatchBankRowBody,
} from '@avroleva/contracts'
import { bankCsvMapping } from '@avroleva/contracts'
import type { Ctx } from '../../platform/http/ctx.js'
import { actorOf } from '../../platform/http/ctx.js'
import { AppError, notFound } from '../../platform/http/errors.js'
import { audit } from '../../platform/audit.js'
import { clock, fromDateOnly, toDateOnly } from '../../platform/clock.js'
import { getTenantSettings, updateTenant } from '../tenancy/index.js'
import { buildings } from '../registry/index.js'
import * as repo from './repo/billing.js'
import * as imports from './repo/imports.js'
import type { ImportLine, ImportRow } from './repo/imports.js'
import { BANK_PRESETS, detectMapping, parseBankCsv } from './domain/bankCsv.js'
import { matchRows } from './domain/match.js'
import type { OpenInvoiceLike } from './domain/match.js'
import { openCentsOf } from './domain/states.js'
import { recordPayment, rollStatuses, toInvoiceDto, withCustomerNames } from './service.js'

export function presets(): BankCsvPresetDto[] {
  return BANK_PRESETS
}

async function openInvoicesForMatching(ctx: Ctx): Promise<OpenInvoiceLike[]> {
  const rows = await repo.openInvoices(ctx.tenantId)
  const dtos = await withCustomerNames(
    ctx,
    rows.map((r) => toInvoiceDto(r)),
  )
  return dtos.map((d) => ({
    id: d.id,
    number: d.number,
    paymentReference: d.paymentReference,
    openCents: d.openCents,
    customerName: d.customerName ?? '',
    buildingId: d.buildingId,
  }))
}

async function toDto(ctx: Ctx, row: ImportRow, parseErrors: string[] = []): Promise<BankImportDto> {
  const invoiceIds = [...new Set(row.rows.map((r) => r.invoiceId).filter(Boolean))] as string[]
  const buildingIds = [...new Set(row.rows.map((r) => r.buildingId).filter(Boolean))] as string[]
  const [invoices, blds] = await Promise.all([
    repo.findInvoices(ctx.tenantId, invoiceIds),
    Promise.all(buildingIds.map((id) => buildings.find(ctx.tenantId, id))),
  ])
  const invById = new Map(invoices.map((i) => [i.id, i]))
  const bldById = new Map(blds.filter(Boolean).map((b) => [b!.id, b!]))
  const rows: BankImportRowDto[] = row.rows.map((r: ImportLine) => {
    const inv = r.invoiceId ? invById.get(r.invoiceId) : undefined
    const bld = r.buildingId
      ? bldById.get(r.buildingId)
      : inv
        ? bldById.get(inv.buildingId)
        : undefined
    return {
      id: r.id,
      position: r.position,
      bookedAt: toDateOnly(r.bookedAt)!,
      amountCents: r.amountCents,
      counterparty: r.counterparty,
      description: r.description,
      reference: r.reference,
      matchKind: r.matchKind,
      status: r.status,
      invoiceId: r.invoiceId,
      invoiceNumber: inv?.number ?? null,
      invoiceOpenCents: inv ? openCentsOf(inv) : null,
      buildingId: r.buildingId ?? inv?.buildingId ?? null,
      buildingAddressText: bld?.addressText ?? inv?.building?.addressText ?? null,
      paymentId: r.paymentId,
      note: r.note,
    }
  })
  return {
    id: row.id,
    filename: row.filename,
    status: row.status,
    mapping: bankCsvMapping.parse(row.mapping ?? {}),
    rowCount: row.rowCount,
    matchedCount: row.matchedCount,
    bookedCount: row.bookedCount,
    createdAt: row.createdAt.toISOString(),
    committedAt: row.committedAt ? row.committedAt.toISOString() : null,
    rows,
    parseErrors,
  }
}

/**
 * Preview: parse with the given / preset / saved / detected mapping, auto-match every row
 * (reference, then amount + name), persist the import in `preview` state so the office can fix
 * the rest by hand, and remember the mapping on the tenant for next time.
 */
export async function preview(ctx: Ctx, body: BankImportPreviewBody): Promise<BankImportDto> {
  const settings = await getTenantSettings(ctx.tenantId)
  let mapping: BankCsvMapping | null = body.mapping ?? null
  if (!mapping && body.preset) {
    const p = BANK_PRESETS.find((x) => x.key === body.preset)
    if (!p) throw new AppError(400, 'billing.import.unknownPreset')
    mapping = p.mapping
  }
  if (!mapping && settings.billing.bankCsvMapping) mapping = settings.billing.bankCsvMapping
  if (!mapping) mapping = detectMapping(body.text)
  if (!mapping) throw new AppError(400, 'billing.import.noMapping')
  const parsed = parseBankCsv(body.text, mapping)
  if (parsed.rows.length === 0) {
    // A saved mapping from another bank: try auto-detection once before giving up.
    const guessed = body.mapping ? null : detectMapping(body.text)
    const second = guessed ? parseBankCsv(body.text, guessed) : null
    if (!second || second.rows.length === 0) throw new AppError(400, 'billing.import.empty')
    mapping = guessed!
    parsed.rows = second.rows
    parsed.errors = second.errors
  }
  await rollStatuses(ctx.tenantId)
  const open = await openInvoicesForMatching(ctx)
  const matched = matchRows(parsed.rows, open)
  const row = await imports.createImport(ctx.tenantId, {
    filename: body.filename,
    mapping: mapping as object,
    createdByUserId: ctx.userId || null,
    rows: matched.map((r) => ({
      position: r.position,
      bookedAt: fromDateOnly(r.bookedAt)!,
      amountCents: r.amountCents,
      counterparty: r.counterparty,
      description: r.description,
      reference: r.reference,
      matchKind: r.matchKind,
      invoiceId: r.invoiceId,
      status: r.invoiceId ? 'proposed' : 'unallocated',
    })),
  })
  if (JSON.stringify(settings.billing.bankCsvMapping) !== JSON.stringify(mapping)) {
    await updateTenant(ctx, {
      settings: { billing: { ...settings.billing, bankCsvMapping: mapping } },
    })
  }
  await audit(actorOf(ctx), {
    action: 'bank_import.preview',
    entityType: 'bank_import',
    entityId: row.id,
    after: { filename: body.filename, rows: row.rowCount, matched: row.matchedCount },
  })
  return toDto(ctx, row, parsed.errors)
}

export async function get(ctx: Ctx, id: string): Promise<BankImportDto> {
  const row = await imports.findImport(ctx.tenantId, id)
  if (!row) throw notFound()
  return toDto(ctx, row)
}

export async function list(ctx: Ctx): Promise<BankImportDto[]> {
  const rows = await imports.listImports(ctx.tenantId, 30)
  return Promise.all(rows.map((r) => toDto(ctx, r)))
}

/** Manual match / ignore / clear on one row; on a committed import a match books the payment. */
export async function matchRow(
  ctx: Ctx,
  importId: string,
  rowId: string,
  body: MatchBankRowBody,
): Promise<BankImportDto> {
  const imp = await imports.findImport(ctx.tenantId, importId)
  if (!imp) throw notFound()
  const line = await imports.findRow(ctx.tenantId, importId, rowId)
  if (!line) throw notFound()
  if (line.status === 'booked') throw new AppError(409, 'billing.import.rowBooked')
  if (body.ignore) {
    await imports.updateRow(ctx.tenantId, rowId, {
      status: 'ignored',
      invoiceId: null,
      buildingId: null,
      matchKind: 'manual',
    })
  } else if (body.invoiceId) {
    const inv = await repo.findInvoice(ctx.tenantId, body.invoiceId)
    if (!inv) throw notFound()
    await imports.updateRow(ctx.tenantId, rowId, {
      status: 'matched',
      invoiceId: inv.id,
      buildingId: inv.buildingId,
      matchKind: 'manual',
    })
  } else if (body.buildingId) {
    if (!(await buildings.find(ctx.tenantId, body.buildingId))) throw notFound()
    await imports.updateRow(ctx.tenantId, rowId, {
      status: 'matched',
      invoiceId: null,
      buildingId: body.buildingId,
      matchKind: 'manual',
    })
  } else {
    await imports.updateRow(ctx.tenantId, rowId, {
      status: 'unallocated',
      invoiceId: null,
      buildingId: null,
      matchKind: 'none',
    })
  }
  await audit(actorOf(ctx), {
    action: 'bank_import.match',
    entityType: 'bank_import_row',
    entityId: rowId,
    after: { importId, ...body },
  })
  if (imp.status === 'committed' && !body.ignore && (body.invoiceId || body.buildingId)) {
    await bookRow(ctx, importId, rowId)
  }
  const fresh = await imports.findImport(ctx.tenantId, importId)
  const matched = fresh!.rows.filter(
    (r) => r.status === 'proposed' || r.status === 'matched',
  ).length
  await imports.updateImport(ctx.tenantId, importId, { matchedCount: matched })
  return toDto(ctx, (await imports.findImport(ctx.tenantId, importId))!)
}

async function bookRow(ctx: Ctx, importId: string, rowId: string): Promise<boolean> {
  const line = await imports.findRow(ctx.tenantId, importId, rowId)
  if (!line || line.status === 'booked' || line.status === 'ignored') return false
  if (!line.invoiceId && !line.buildingId) return false
  let buildingId = line.buildingId
  let invoiceId = line.invoiceId
  if (invoiceId) {
    const inv = await repo.findInvoice(ctx.tenantId, invoiceId)
    if (!inv) return false
    if (openCentsOf(inv) <= 0) {
      // Settled meanwhile: keep the money on the building instead of failing the import.
      invoiceId = null
    }
    buildingId = inv.buildingId
  }
  const r = await recordPayment(ctx, {
    invoiceId,
    buildingId: buildingId!,
    amountCents: line.amountCents,
    paidAt: toDateOnly(line.bookedAt)!,
    method: 'bank',
    note: line.description.slice(0, 500) || null,
    reference: line.reference,
    source: 'bank_import',
    counterparty: line.counterparty.slice(0, 200) || null,
    bankImportRowId: line.id,
  })
  await imports.updateRow(ctx.tenantId, rowId, {
    status: 'booked',
    paymentId: r.payment.id,
    invoiceId,
    buildingId,
  })
  return true
}

/** Books every proposed / matched row as a payment; unallocated and ignored rows stay as they are. */
export async function commit(ctx: Ctx, id: string): Promise<BankImportCommitResultDto> {
  const imp = await imports.findImport(ctx.tenantId, id)
  if (!imp) throw notFound()
  if (imp.status === 'committed') throw new AppError(409, 'billing.import.alreadyCommitted')
  let booked = 0
  for (const line of imp.rows) {
    if (line.status !== 'proposed' && line.status !== 'matched') continue
    if (await bookRow(ctx, id, line.id)) booked++
  }
  const fresh = await imports.findImport(ctx.tenantId, id)
  const unallocated = fresh!.rows.filter((r) => r.status === 'unallocated').length
  const ignored = fresh!.rows.filter((r) => r.status === 'ignored').length
  await imports.updateImport(ctx.tenantId, id, {
    status: 'committed',
    committedAt: clock.now(),
    bookedCount: booked,
  })
  await audit(actorOf(ctx), {
    action: 'bank_import.commit',
    entityType: 'bank_import',
    entityId: id,
    after: { booked, unallocated, ignored },
  })
  return { importId: id, booked, unallocated, ignored }
}
