import type {
  BuildingReportDto,
  BulkBuildingReportBody,
  BulkReportResultDto,
  Page,
  ReportListQuery,
  ReportRunDto,
  SendBuildingReportBody,
  SendStatementBody,
} from '@avroleva/contracts'
import { formatDate } from '@avroleva/i18n'
import { prismaBase } from '../../platform/db/prisma.js'
import type { Ctx } from '../../platform/http/ctx.js'
import { actorOf } from '../../platform/http/ctx.js'
import { AppError, notFound } from '../../platform/http/errors.js'
import { audit } from '../../platform/audit.js'
import { clock, fromDateOnly, monthBounds, addDays } from '../../platform/clock.js'
import { config } from '../../platform/config.js'
import { logger } from '../../platform/logger.js'
import { newId } from '../../platform/ids.js'
import { getTenant } from '../tenancy/index.js'
import { buildings } from '../registry/index.js'
import * as visits from '../visits/index.js'
import * as callbacks from '../callbacks/index.js'
import * as defects from '../defects/index.js'
import * as billing from '../billing/index.js'
import { monthLabel, renderBuildingReportHtml } from './domain/buildingReportHtml.js'
import { reportNotifier } from './domain/ports.js'

/**
 * Monthly building report (MVP-PLAN phase 8): one DTO per (building, month) built from the
 * modules' public queries, rendered to HTML (print page + e-mail attachment), every generation
 * logged as `report_run`.
 */
export async function buildingReport(
  ctx: Ctx,
  buildingId: string,
  month: string,
): Promise<BuildingReportDto> {
  const { start, end } = monthBounds(month)
  const from = fromDateOnly(start)!
  const to = fromDateOnly(addDays(end, 1))!
  const [tenant, b] = await Promise.all([getTenant(ctx.tenantId), buildings.get(ctx, buildingId)])
  const [visitRows, cbPage, defectPage, money] = await Promise.all([
    visits.listForBuildingPeriod(ctx.tenantId, buildingId, from, to),
    callbacks.list(ctx, { limit: 200, buildingId, from: start, to: addDays(end, 1) }),
    defects.list(ctx, { limit: 200, buildingId, open: true }),
    billing.buildingBilling(ctx, buildingId),
  ])
  const primary = b.contacts.find((c) => c.isPrimary) ?? b.contacts[0] ?? null
  const withEmail = b.contacts.find((c) => c.email) ?? null
  const responses: number[] = []
  const elevators = b.elevators
    .filter((e) => e.status !== 'scrapped')
    .map((e) => {
      const ev = visitRows.filter((v) => v.elevatorId === e.id)
      const ec = cbPage.items.filter((c) => c.elevatorId === e.id)
      for (const c of ec) if (c.responseMinutes != null) responses.push(c.responseMinutes)
      return {
        id: e.id,
        internalNo: e.internalNo,
        regNo: e.regNo,
        status: e.status,
        nextCheckDueAt: e.nextCheckDue,
        nextInspectionAt: e.nextInspectionAt,
        visits: ev.map((v) => ({
          id: v.id,
          startedAt: v.startedAt,
          kind: v.kind,
          technicians: v.technicians.map((x) => x.name),
          checklistSummary: v.checklist?.summary ?? null,
          defectsFound: (v.checklist?.items ?? [])
            .filter((i) => i.result === 'defect')
            .map((i) => (ctx.locale === 'en' ? i.label.en : i.label.bg)),
          notes: v.notes,
        })),
        callbacks: ec.map((c) => ({
          id: c.id,
          receivedAt: c.receivedAt,
          classification: c.classification,
          status: c.status,
          responseMinutes: c.responseMinutes,
          cause: c.cause,
        })),
        openDefects: defectPage.items
          .filter((d) => d.elevatorId === e.id)
          .map((d) => ({
            id: d.id,
            description: d.catalogRef ? `${d.catalogRef} · ${d.description}` : d.description,
            recordedAt: d.recordedAt,
            stopLift: d.stopLift,
          })),
      }
    })
  const invoices = money.invoices
    .filter((i) => i.period === month || i.openCents > 0)
    .map((i) => ({
      id: i.id,
      number: i.number,
      period: i.period,
      totalCents: i.totalCents,
      paidCents: i.paidCents,
      status: i.status,
      dueAt: i.dueAt,
    }))
  return {
    period: month,
    periodStart: start,
    periodEnd: end,
    generatedAt: clock.now().toISOString(),
    tenant: {
      name: tenant.name,
      phone: tenant.phone,
      emergencyPhone: tenant.emergencyPhone,
      email: tenant.email,
      address: tenant.address,
    },
    building: {
      id: b.id,
      addressText: b.addressText,
      customerName: b.customerName ?? null,
      contactName: primary?.name ?? null,
      contactEmail: withEmail?.email ?? null,
      contactPhone: primary?.phone ?? null,
    },
    elevators,
    totals: {
      visits: visitRows.length,
      callbacks: cbPage.items.length,
      avgResponseMinutes: responses.length
        ? Math.round(responses.reduce((a, b) => a + b, 0) / responses.length)
        : null,
      openDefects: defectPage.items.length,
    },
    billing: {
      invoices,
      outstandingCents: money.invoices.reduce((s, i) => s + i.openCents, 0),
    },
  }
}

export function buildingReportHtml(
  ctx: Ctx,
  report: BuildingReportDto,
  opts: { toolbar?: boolean; scriptUrl?: string } = {},
): string {
  return renderBuildingReportHtml(report, ctx.t, ctx.locale, opts)
}

function printUrl(buildingId: string, month: string): string {
  const base = config.BASE_PATH === '/' ? '' : config.BASE_PATH
  return `${base}/print/building-report/${buildingId}?month=${month}`
}

interface RunRow {
  id: string
  kind: string
  buildingId: string | null
  period: string
  status: 'generated' | 'sent' | 'failed' | 'skipped'
  sentTo: string | null
  notificationId: string | null
  error: string | null
  byUserId: string | null
  createdAt: Date
}

function toRunDto(r: RunRow, addressText: string | null): ReportRunDto {
  return {
    id: r.id,
    kind: r.kind === 'statement' ? 'statement' : 'building_month',
    buildingId: r.buildingId,
    buildingAddressText: addressText,
    period: r.period,
    status: r.status,
    sentTo: r.sentTo,
    notificationId: r.notificationId,
    error: r.error,
    byUserId: r.byUserId,
    createdAt: r.createdAt.toISOString(),
    printUrl: r.buildingId
      ? r.kind === 'statement'
        ? statementPrintUrl(r.buildingId, r.period)
        : printUrl(r.buildingId, r.period)
      : null,
  }
}

function statementPrintUrl(buildingId: string, period: string): string {
  const base = config.BASE_PATH === '/' ? '' : config.BASE_PATH
  const [from, to] = period.split('..')
  return `${base}/print/statement/${buildingId}?from=${from ?? ''}&to=${to ?? ''}`
}

async function logRun(
  ctx: Ctx,
  data: Omit<RunRow, 'id' | 'createdAt' | 'kind' | 'byUserId'> & { kind?: string },
): Promise<RunRow> {
  return prismaBase.reportRun.create({
    data: {
      id: newId(),
      tenantId: ctx.tenantId,
      kind: 'building_month',
      byUserId: ctx.userId || null,
      ...data,
    },
  })
}

/**
 * Statement per building by e-mail (ADR 0001): the same HTML as /print/statement as an
 * attachment, through the `statement_sent` template, logged as a `report_run` of kind
 * `statement` with the window as the period ("from..to").
 */
export async function sendStatement(
  ctx: Ctx,
  buildingId: string,
  body: SendStatementBody,
): Promise<ReportRunDto> {
  const st = await billing.statement(ctx, buildingId, { from: body.from, to: body.to })
  const to = body.email ?? st.contactEmail
  const period = `${st.from}..${st.to}`
  if (!to) {
    const run = await logRun(ctx, {
      kind: 'statement',
      buildingId,
      period,
      status: 'skipped',
      sentTo: null,
      notificationId: null,
      error: 'reports.noEmail',
    })
    throw new AppError(400, 'reports.noEmail', { detail: run.id })
  }
  const tenant = await getTenant(ctx.tenantId)
  const html = billing.renderStatementHtml(st, tenant, ctx.t, { lang: ctx.locale })
  const openCents = st.openInvoices.reduce((s, i) => s + i.openCents, 0)
  const label = `${formatDate(st.from, ctx.locale)} – ${formatDate(st.to, ctx.locale)}`
  try {
    const n = await reportNotifier().sendEmail(ctx.tenantId, {
      key: 'statement_sent',
      to,
      data: {
        building: {
          id: buildingId,
          addressText: st.buildingAddressText,
          customerName: st.customerName,
        },
        contact: { name: st.contactName ?? '', email: to },
        bank: st.bank ?? { iban: '' },
        statement: {
          periodLabel: label,
          closingBalanceCents: st.closingBalanceCents,
          openCount: st.openInvoices.length,
          openCents,
          reference: st.epc?.reference ?? st.openInvoices.map((i) => i.paymentReference).join(', '),
        },
      },
      relatedType: 'building',
      relatedId: buildingId,
      attachments: [
        {
          filename: `izvlechenie-${st.from}-${st.to}.html`,
          content: html,
          contentType: 'text/html; charset=utf-8',
        },
      ],
    })
    const run = await logRun(ctx, {
      kind: 'statement',
      buildingId,
      period,
      status: 'sent',
      sentTo: to,
      notificationId: n.id,
      error: null,
    })
    await reportNotifier().notifyUsers(ctx.tenantId, {
      key: 'statement_sent',
      roles: ['owner', 'office'],
      data: {
        building: { id: buildingId, addressText: st.buildingAddressText },
        contact: { name: st.contactName ?? '', email: to },
        statement: { periodLabel: label, closingBalanceCents: st.closingBalanceCents },
      },
      relatedType: 'building',
      relatedId: buildingId,
      link: `/buildings/${buildingId}/statement`,
    })
    await audit(actorOf(ctx), {
      action: 'statement.send',
      entityType: 'report_run',
      entityId: run.id,
      after: { buildingId, from: st.from, to: st.to, to_email: to },
    })
    return toRunDto(run, st.buildingAddressText)
  } catch (err) {
    if (err instanceof AppError) throw err
    logger.error({ err, buildingId }, 'statement send failed')
    const run = await logRun(ctx, {
      kind: 'statement',
      buildingId,
      period,
      status: 'failed',
      sentTo: to,
      notificationId: null,
      error: String((err as Error)?.message ?? err).slice(0, 500),
    })
    throw new AppError(500, 'reports.sendFailed', { detail: run.id })
  }
}

/** "Generate" without sending: logs the run so the office sees when a report was produced. */
export async function generateBuildingReport(
  ctx: Ctx,
  buildingId: string,
  month: string,
): Promise<ReportRunDto> {
  const report = await buildingReport(ctx, buildingId, month)
  const run = await logRun(ctx, {
    buildingId,
    period: month,
    status: 'generated',
    sentTo: null,
    notificationId: null,
    error: null,
  })
  await audit(actorOf(ctx), {
    action: 'report.building.generate',
    entityType: 'report_run',
    entityId: run.id,
    after: { buildingId, month },
  })
  return toRunDto(run, report.building.addressText)
}

/** E-mails the report (HTML attached) to the building contact through the notifications port. */
export async function sendBuildingReport(
  ctx: Ctx,
  buildingId: string,
  body: SendBuildingReportBody,
): Promise<ReportRunDto> {
  const report = await buildingReport(ctx, buildingId, body.month)
  const to = body.to ?? report.building.contactEmail
  if (!to) {
    const run = await logRun(ctx, {
      buildingId,
      period: body.month,
      status: 'skipped',
      sentTo: null,
      notificationId: null,
      error: 'reports.noEmail',
    })
    throw new AppError(400, 'reports.noEmail', { detail: run.id })
  }
  const html = buildingReportHtml(ctx, report)
  const label = monthLabel(body.month, ctx.locale)
  try {
    const n = await reportNotifier().sendEmail(ctx.tenantId, {
      key: 'building_report',
      to,
      data: {
        building: report.building,
        contact: { name: report.building.contactName ?? '', email: to },
        report: {
          periodLabel: label,
          visits: report.totals.visits,
          callbacks: report.totals.callbacks,
          avgResponseMinutes: report.totals.avgResponseMinutes,
          openDefects: report.totals.openDefects,
        },
      },
      relatedType: 'building',
      relatedId: buildingId,
      attachments: [
        {
          filename: `otchet-${body.month}.html`,
          content: html,
          contentType: 'text/html; charset=utf-8',
        },
      ],
    })
    const run = await logRun(ctx, {
      buildingId,
      period: body.month,
      status: 'sent',
      sentTo: to,
      notificationId: n.id,
      error: null,
    })
    await audit(actorOf(ctx), {
      action: 'report.building.send',
      entityType: 'report_run',
      entityId: run.id,
      after: { buildingId, month: body.month, to },
    })
    return toRunDto(run, report.building.addressText)
  } catch (err) {
    logger.error({ err, buildingId }, 'report send failed')
    const run = await logRun(ctx, {
      buildingId,
      period: body.month,
      status: 'failed',
      sentTo: to,
      notificationId: null,
      error: String((err as Error)?.message ?? err).slice(0, 500),
    })
    throw new AppError(500, 'reports.sendFailed', { detail: run.id })
  }
}

/** All buildings of the tenant for one month: generate (and optionally send where an e-mail exists). */
export async function bulkBuildingReports(
  ctx: Ctx,
  body: BulkBuildingReportBody,
): Promise<BulkReportResultDto> {
  const rows = await prismaBase.building.findMany({
    where: { tenantId: ctx.tenantId, deletedAt: null },
    select: { id: true },
    orderBy: { addressText: 'asc' },
  })
  const out: BulkReportResultDto = {
    period: body.month,
    buildings: rows.length,
    generated: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
  }
  for (const b of rows) {
    try {
      if (!body.send) {
        await generateBuildingReport(ctx, b.id, body.month)
        out.generated++
        continue
      }
      await sendBuildingReport(ctx, b.id, { month: body.month })
      out.sent++
    } catch (err) {
      if (err instanceof AppError && err.code === 'reports.noEmail') out.skipped++
      else out.failed++
    }
  }
  await audit(actorOf(ctx), {
    action: 'report.building.bulk',
    entityType: 'report_run',
    entityId: body.month,
    after: out,
  })
  return out
}

export async function listReportRuns(ctx: Ctx, q: ReportListQuery): Promise<Page<ReportRunDto>> {
  const cursor = q.cursor ? parseCursor(q.cursor) : null
  const rows = await prismaBase.reportRun.findMany({
    where: {
      tenantId: ctx.tenantId,
      ...(q.buildingId ? { buildingId: q.buildingId } : {}),
      ...(q.period ? { period: q.period } : {}),
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: q.limit + 1,
  })
  const items = rows.slice(0, q.limit)
  const ids = [...new Set(items.map((r) => r.buildingId).filter((x): x is string => !!x))]
  const bs = ids.length
    ? await prismaBase.building.findMany({
        where: { tenantId: ctx.tenantId, id: { in: ids } },
        select: { id: true, addressText: true },
      })
    : []
  const names = new Map(bs.map((b) => [b.id, b.addressText]))
  return {
    items: items.map((r) => toRunDto(r, r.buildingId ? (names.get(r.buildingId) ?? null) : null)),
    nextCursor:
      rows.length > q.limit
        ? `${items[items.length - 1]!.createdAt.toISOString()}|${items[items.length - 1]!.id}`
        : null,
  }
}

function parseCursor(c: string): { createdAt: Date; id: string } | null {
  const [iso, id] = c.split('|')
  if (!iso || !id) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : { createdAt: d, id }
}

export async function getReportRun(ctx: Ctx, id: string): Promise<ReportRunDto> {
  const r = await prismaBase.reportRun.findFirst({ where: { id, tenantId: ctx.tenantId } })
  if (!r) throw notFound()
  return toRunDto(r, null)
}
