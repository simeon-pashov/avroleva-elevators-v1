import { useState } from 'react'
import { Link } from 'react-router'
import type { BulkReportResultDto, Page, ReportRunDto } from '@avroleva/contracts'
import { get, post, qs, serverPath } from '../../lib/api'
import { currentMonthSofia } from '../../lib/dates'
import { useI18n } from '../../i18n/I18nProvider'
import {
  Badge,
  ConfirmButton,
  Empty,
  ErrorBox,
  Field,
  LoadMore,
  PageHeader,
  Spinner,
  toast,
  useCursorList,
} from '../../components/ui'
import { reportStatusBadge } from '../buildings/BuildingReportCard'

/** "Отчети": bulk generate / send the monthly building report, and the list of report runs. */
export function ReportsPage() {
  const { t, dateTime } = useI18n()
  const [month, setMonth] = useState(currentMonthSofia())
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<BulkReportResultDto | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [version, setVersion] = useState(0)

  const list = useCursorList<ReportRunDto>(
    (cursor) => get<Page<ReportRunDto>>(`/reports${qs({ cursor, limit: 50 })}`),
    [version],
  )

  const bulk = async (send: boolean) => {
    setBusy(true)
    setError(null)
    try {
      const r = await post<BulkReportResultDto>('/reports/building/bulk', { month, send })
      setResult(r)
      toast(t('reports.bulkResult', { ...r }))
      setVersion((v) => v + 1)
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  const validMonth = /^\d{4}-\d{2}$/.test(month)

  return (
    <div>
      <PageHeader title={t('reports.title')} subtitle={t('reports.subtitle')} />
      <div className="card">
        <div className="row report-row">
          <Field label={t('reports.month')}>
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </Field>
          <div className="actions report-actions">
            <button
              type="button"
              className="btn"
              disabled={busy || !validMonth}
              onClick={() => bulk(false)}
            >
              {t('reports.generateAll')}
            </button>
            <ConfirmButton
              className="btn btn-primary"
              label={t('reports.sendAll')}
              disabled={busy || !validMonth}
              onConfirm={() => bulk(true)}
            />
          </div>
        </div>
        <ErrorBox error={error} />
        {result ? (
          <div className="inset small">{t('reports.bulkResult', { ...result })}</div>
        ) : null}
      </div>
      <div className="card">
        <h2>{t('reports.runs')}</h2>
        <ErrorBox error={list.error} />
        {list.loading && list.items.length === 0 ? (
          <Spinner />
        ) : list.items.length === 0 ? (
          <Empty text={t('reports.noRuns')} />
        ) : (
          <div className="table-wrap">
            <table className="table compact">
              <thead>
                <tr>
                  <th>{t('reports.created')}</th>
                  <th>{t('reports.building')}</th>
                  <th>{t('reports.period')}</th>
                  <th>{t('reports.status')}</th>
                  <th>{t('reports.sentTo')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.items.map((r) => (
                  <tr key={r.id}>
                    <td>{dateTime(r.createdAt)}</td>
                    <td>
                      {r.buildingId ? (
                        <Link to={`/buildings/${r.buildingId}`}>{r.buildingAddressText}</Link>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>{r.period}</td>
                    <td>
                      <Badge kind={reportStatusBadge(r.status)}>
                        {t(`enum.reportRunStatus.${r.status}`)}
                      </Badge>
                      {r.error ? <div className="small text-danger">{r.error}</div> : null}
                    </td>
                    <td>{r.sentTo ?? <span className="muted">—</span>}</td>
                    <td className="num">
                      {r.printUrl ? (
                        <a
                          className="btn btn-small"
                          href={serverPath(r.printUrl)}
                          target="_blank"
                          rel="noopener"
                        >
                          {t('reports.print')}
                        </a>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <LoadMore hasMore={list.hasMore} loading={list.loading} onClick={list.loadMore} />
      </div>
    </div>
  )
}
