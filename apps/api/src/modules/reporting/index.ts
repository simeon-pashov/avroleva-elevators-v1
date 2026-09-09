/**
 * reporting (L4) - dashboard, the merged deadlines calendar, CSV / full exports, the monthly
 * building report. Read-only over the other modules' public queries (and, by the ownership rule,
 * may SELECT any table). Owns: export_job, report_run. Talks to notifications (same layer)
 * through the `ReportNotifier` port wired in app.ts.
 */
import { Router } from 'express'
import {
  bulkBuildingReportBody,
  buildingReportQuery,
  calendarQuery,
  reportListQuery,
  sendBuildingReportBody,
  sendStatementBody,
} from '@avroleva/contracts'
import { ctxOf, requireAuth, requireRole } from '../../platform/http/ctx.js'
import { notFound } from '../../platform/http/errors.js'
import { parseBody, parseId, parseQuery } from '../../platform/http/validate.js'
import { calendarFromQuery, calendarItems, dashboard } from './service.js'
import {
  getExport,
  isDataset,
  listExports,
  readExport,
  requestFullExport,
  streamCsv,
} from './exports.js'
import {
  buildingReport,
  bulkBuildingReports,
  generateBuildingReport,
  getReportRun,
  listReportRuns,
  sendBuildingReport,
  sendStatement,
} from './reports.js'

export { dashboard, calendarItems }
export {
  streamCsv,
  datasetToCsv,
  requestFullExport,
  runFullExport,
  listExports,
  exportStorageKeys,
  exportStorageKey,
  FULL_EXPORT_JOB,
} from './exports.js'
export {
  buildingReport,
  buildingReportHtml,
  sendBuildingReport,
  generateBuildingReport,
  bulkBuildingReports,
  listReportRuns,
  sendStatement,
} from './reports.js'
export { useReportNotifier } from './domain/ports.js'
export type { ReportNotifier } from './domain/ports.js'
export { csvCell, csvLine, CSV_BOM } from './domain/csv.js'
export { monthLabel, renderBuildingReportHtml } from './domain/buildingReportHtml.js'

export const reportingRouter = Router()
reportingRouter.use(requireAuth)
reportingRouter.get('/dashboard', async (req, res) => {
  res.json(await dashboard(ctxOf(req)))
})
reportingRouter.get('/calendar', async (req, res) => {
  res.json(await calendarFromQuery(ctxOf(req), parseQuery(calendarQuery, req)))
})

/** Exports: owner + office (technicians never export, ARCHITECTURE section 5 roles). */
export const exportsRouter = Router()
exportsRouter.use('/exports', requireRole('owner', 'office'))
exportsRouter.get('/exports', async (req, res) => {
  res.json({ items: await listExports(ctxOf(req)) })
})
exportsRouter.post('/exports/full', async (req, res) => {
  res.status(202).json(await requestFullExport(ctxOf(req)))
})
exportsRouter.get('/exports/:dataset.csv', async (req, res) => {
  const name = String(req.params.dataset)
  if (!isDataset(name)) throw notFound()
  await streamCsv(ctxOf(req), name, res)
})
exportsRouter.get('/exports/:id', async (req, res) => {
  res.json(await getExport(ctxOf(req), parseId(req)))
})

/** Signed download of a finished full export (mounted at /files/export, outside /api: no cookie). */
export const exportFilesRouter = Router()
exportFilesRouter.get('/:id', async (req, res) => {
  const id = String(req.params.id)
  const exp = Number(req.query.exp)
  const sig = String(req.query.sig ?? '')
  if (!/^[0-9a-f-]{36}$/i.test(id) || !Number.isFinite(exp) || !/^[0-9a-f]{64}$/.test(sig))
    throw notFound()
  const f = await readExport(id, exp, sig)
  if (!f) throw notFound()
  res.setHeader('Content-Type', 'application/zip')
  res.setHeader('Content-Disposition', `attachment; filename="${f.filename}"`)
  res.setHeader('Cache-Control', 'private, no-store')
  res.send(f.bytes)
})

/** Monthly building reports: owner + office. */
export const reportsRouter = Router()
reportsRouter.use('/reports', requireRole('owner', 'office'))
reportsRouter.get('/reports', async (req, res) => {
  res.json(await listReportRuns(ctxOf(req), parseQuery(reportListQuery, req)))
})
reportsRouter.get('/reports/building/:id', async (req, res) => {
  const q = parseQuery(buildingReportQuery, req)
  res.json(await buildingReport(ctxOf(req), parseId(req), q.month))
})
reportsRouter.post('/reports/building/:id/generate', async (req, res) => {
  const q = parseBody(buildingReportQuery, req)
  res.status(201).json(await generateBuildingReport(ctxOf(req), parseId(req), q.month))
})
reportsRouter.post('/reports/building/:id/send', async (req, res) => {
  res
    .status(201)
    .json(
      await sendBuildingReport(ctxOf(req), parseId(req), parseBody(sendBuildingReportBody, req)),
    )
})
reportsRouter.post('/reports/statement/:id/send', async (req, res) => {
  res
    .status(201)
    .json(await sendStatement(ctxOf(req), parseId(req), parseBody(sendStatementBody, req)))
})
reportsRouter.post('/reports/building/bulk', async (req, res) => {
  res.json(await bulkBuildingReports(ctxOf(req), parseBody(bulkBuildingReportBody, req)))
})
reportsRouter.get('/reports/:id', async (req, res) => {
  res.json(await getReportRun(ctxOf(req), parseId(req)))
})

export const moduleInfo = { name: 'reporting', layer: 4, status: 'active' } as const
