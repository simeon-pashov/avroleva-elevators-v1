import { useState } from 'react'
import { Link } from 'react-router'
import type { ImportBatchDto } from '@avroleva/contracts'
import { apiUrl, post } from '../lib/api'
import { useI18n } from '../i18n/I18nProvider'
import { Badge, ErrorBox, PageHeader, toast } from '../components/ui'

export function ImportPage() {
  const { t } = useI18n()
  const [filename, setFilename] = useState('')
  const [csv, setCsv] = useState('')
  const [batch, setBatch] = useState<ImportBatchDto | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setFilename(file.name)
    const buf = await file.arrayBuffer()
    // Excel "CSV UTF-8" carries a BOM; plain "CSV" is often Windows-1251 - try both.
    let text = new TextDecoder('utf-8', { fatal: false }).decode(buf)
    if (text.includes('�')) text = new TextDecoder('windows-1251').decode(buf)
    setCsv(text)
    setBatch(null)
  }

  const preview = async () => {
    setBusy(true)
    setError(null)
    try {
      setBatch(
        await post<ImportBatchDto>('/imports/preview', { filename: filename || 'import.csv', csv }),
      )
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  const commit = async () => {
    if (!batch) return
    setBusy(true)
    setError(null)
    try {
      const done = await post<ImportBatchDto>(`/imports/${batch.id}/commit`)
      setBatch(done)
      toast(t('import.committed'))
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHeader
        title={t('import.title')}
        actions={
          <a className="btn" href={apiUrl('/imports/template.csv')}>
            {t('import.downloadTemplate')}
          </a>
        }
      />
      <div className="card">
        <p className="muted">{t('import.intro')}</p>
        <div className="row">
          <label className="field">
            <span className="field-label">{t('import.file')}</span>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
          </label>
        </div>
        <label className="field">
          <span className="field-label">{t('import.pasteCsv')}</span>
          <textarea
            rows={6}
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            placeholder="Ползвател;Тип ползвател;…"
          />
        </label>
        <div className="actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!csv.trim() || busy}
            onClick={preview}
          >
            {t('import.preview')}
          </button>
        </div>
        <ErrorBox error={error} />
      </div>

      {batch ? (
        <div className="card">
          <div className="card-head">
            <h2>
              {t('import.previewTitle', { rows: batch.rowCount })}{' '}
              <Badge
                kind={
                  batch.status === 'committed' ? 'ok' : batch.errorCount > 0 ? 'danger' : 'warn'
                }
              >
                {t(`enum.importStatus.${batch.status}`)}
              </Badge>
            </h2>
            <div className="actions">
              <span className="muted small">
                {t('import.errors', { count: batch.errorCount })} ·{' '}
                {t('import.warnings', { count: batch.warningCount })}
              </span>
              {batch.status === 'preview' ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={batch.errorCount > 0 || busy}
                  onClick={commit}
                >
                  {t('import.commit')}
                </button>
              ) : null}
            </div>
          </div>
          {batch.status === 'committed' && batch.created ? (
            <p>
              {t('import.createdSummary', batch.created)}{' '}
              <Link to="/buildings">{t('nav.buildings')}</Link>
              {' · '}
              <Link to="/buildings?geocodeStatus=pending">{t('geo.placeImported')}</Link>
            </p>
          ) : null}
          {batch.issues.length > 0 ? (
            <div className="table-wrap">
              <table className="table compact">
                <thead>
                  <tr>
                    <th>{t('import.row')}</th>
                    <th>{t('import.column')}</th>
                    <th>{t('import.message')}</th>
                  </tr>
                </thead>
                <tbody>
                  {batch.issues.map((i, idx) => (
                    <tr key={idx} className={i.level === 'error' ? 'row-error' : 'row-warning'}>
                      <td>{i.row || '—'}</td>
                      <td>{i.column}</td>
                      <td>{t(i.code)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {batch.rows.length > 0 ? (
            <div className="table-wrap">
              <table className="table compact">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{t('customers.name')}</th>
                    <th>{t('buildings.address')}</th>
                    <th>{t('elevators.internalNo')}</th>
                    <th>{t('elevators.regNo')}</th>
                    <th>{t('elevators.stops')}</th>
                    <th>{t('contracts.monthlyPriceEur')}</th>
                    <th>{t('elevators.lastCheckAt')}</th>
                  </tr>
                </thead>
                <tbody>
                  {batch.rows.slice(0, 200).map((r) => (
                    <tr key={r.row}>
                      <td>{r.row}</td>
                      <td>{r.customerName}</td>
                      <td>{r.addressText}</td>
                      <td>{r.internalNo}</td>
                      <td>{r.regNo ?? ''}</td>
                      <td>{r.stops}</td>
                      <td>
                        {r.monthlyPriceCents != null ? (r.monthlyPriceCents / 100).toFixed(2) : ''}
                      </td>
                      <td>{r.lastCheckAt ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
