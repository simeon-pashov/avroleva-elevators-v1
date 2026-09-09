import { useState } from 'react'
import { Link } from 'react-router'
import type { BuildingDetailDto, ReportRunDto } from '@avroleva/contracts'
import { ApiError, post, serverPath } from '../../lib/api'
import { todaySofia } from '../../lib/dates'
import { useI18n } from '../../i18n/I18nProvider'
import { ErrorBox, Field, toast } from '../../components/ui'

/** Default window of the statement: the last 12 months up to today. */
export function defaultStatementRange(): { from: string; to: string } {
  const to = todaySofia()
  const [y, m, d] = to.split('-')
  return { from: `${Number(y) - 1}-${m}-${d}`, to }
}

export const printStatementUrl = (buildingId: string, from: string, to: string) =>
  serverPath(`/print/statement/${buildingId}?from=${from}&to=${to}`)

/** "Извлечение": period pickers, open the ledger page, print it, e-mail it to the contact. */
export function BuildingStatementCard({ building }: { building: BuildingDetailDto }) {
  const { t } = useI18n()
  const [range, setRange] = useState(defaultStatementRange)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(range.from) && /^\d{4}-\d{2}-\d{2}$/.test(range.to)

  const send = async () => {
    setBusy(true)
    setError(null)
    try {
      const run = await post<ReportRunDto>(`/reports/statement/${building.id}/send`, range)
      toast(run.sentTo ? t('reports.sent', { to: run.sentTo }) : t('reports.statementSent'))
    } catch (e) {
      if (e instanceof ApiError && e.problem.code === 'reports.noEmail')
        toast(e.problem.title, 'error')
      else setError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <h2>{t('statement.title')}</h2>
      <p className="muted small">{t('statement.cardHint')}</p>
      <div className="row report-row">
        <Field label={t('statement.from')}>
          <input
            type="date"
            value={range.from}
            max={range.to}
            onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
          />
        </Field>
        <Field label={t('statement.to')}>
          <input
            type="date"
            value={range.to}
            min={range.from}
            onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
          />
        </Field>
      </div>
      <div className="actions report-actions">
        <Link
          className="btn btn-primary"
          to={`/buildings/${building.id}/statement?from=${range.from}&to=${range.to}`}
        >
          {t('statement.show')}
        </Link>
        <a
          className="btn"
          href={printStatementUrl(building.id, range.from, range.to)}
          target="_blank"
          rel="noopener"
        >
          {t('reports.print')}
        </a>
        <button type="button" className="btn" disabled={busy || !valid} onClick={() => void send()}>
          {t('statement.sendEmail')}
        </button>
      </div>
      <ErrorBox error={error} />
    </div>
  )
}
