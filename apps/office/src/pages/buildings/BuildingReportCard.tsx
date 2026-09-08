import { useCallback, useEffect, useState } from 'react'
import type { BuildingDetailDto, Page, ReportRunDto, ReportRunStatus } from '@avroleva/contracts'
import { ApiError, get, post, qs, serverPath } from '../../lib/api'
import { currentMonthSofia } from '../../lib/dates'
import { useI18n } from '../../i18n/I18nProvider'
import { Badge, ErrorBox, Field, toast } from '../../components/ui'

export function reportStatusBadge(s: ReportRunStatus): 'ok' | 'warn' | 'danger' | 'muted' {
  switch (s) {
    case 'sent':
      return 'ok'
    case 'failed':
      return 'danger'
    case 'skipped':
      return 'warn'
    default:
      return 'muted'
  }
}

export const printReportUrl = (buildingId: string, month: string) =>
  serverPath(`/print/building-report/${buildingId}?month=${month}`)

/** "Месечен отчет": month picker, print page, send to the contact, last runs for this building. */
export function BuildingReportCard({ building }: { building: BuildingDetailDto }) {
  const { t, dateTime } = useI18n()
  const [month, setMonth] = useState(currentMonthSofia())
  const [runs, setRuns] = useState<ReportRunDto[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)

  const load = useCallback(async () => {
    try {
      const r = await get<Page<ReportRunDto>>(
        `/reports${qs({ buildingId: building.id, limit: 10 })}`,
      )
      setRuns(r.items)
    } catch (e) {
      setError(e)
    }
  }, [building.id])

  useEffect(() => {
    void load()
  }, [load])

  const send = async () => {
    setBusy(true)
    setError(null)
    try {
      const run = await post<ReportRunDto>(`/reports/building/${building.id}/send`, { month })
      toast(t('reports.sent', { to: run.sentTo ?? '' }))
      await load()
    } catch (e) {
      if (e instanceof ApiError && e.problem.code === 'reports.noEmail')
        toast(e.problem.title, 'error')
      else setError(e)
      await load()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <h2>{t('buildings.reportTitle')}</h2>
      <p className="muted small">{t('buildings.reportHint')}</p>
      <div className="row report-row">
        <Field label={t('reports.month')}>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </Field>
        <div className="actions report-actions">
          <a
            className="btn"
            href={printReportUrl(building.id, month)}
            target="_blank"
            rel="noopener"
          >
            {t('reports.openPrint')}
          </a>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !/^\d{4}-\d{2}$/.test(month)}
            onClick={send}
          >
            {t('reports.sendToContact')}
          </button>
        </div>
      </div>
      <ErrorBox error={error} />
      <h3 className="sub-head">{t('reports.lastRuns')}</h3>
      {!runs || runs.length === 0 ? (
        <p className="muted small">{t('reports.noRuns')}</p>
      ) : (
        <ul className="list compact">
          {runs.map((r) => (
            <li key={r.id}>
              <span className="muted small">{dateTime(r.createdAt)}</span> · {r.period}{' '}
              <Badge kind={reportStatusBadge(r.status)}>
                {t(`enum.reportRunStatus.${r.status}`)}
              </Badge>{' '}
              {r.sentTo ? <span className="small">{r.sentTo}</span> : null}
              {r.error ? <span className="small text-danger"> {r.error}</span> : null}
              {r.printUrl ? (
                <>
                  {' '}
                  <a href={serverPath(r.printUrl)} target="_blank" rel="noopener" className="small">
                    {t('reports.print')}
                  </a>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
