import { useCallback, useEffect, useState } from 'react'
import type { ExportJobDto, ExportJobStatus, TenantDto } from '@avroleva/contracts'
import { EXPORT_DATASETS, TENANT_DELETION_GRACE_DAYS } from '@avroleva/contracts'
import { ApiError, get, post, serverPath } from '../../lib/api'
import { useI18n } from '../../i18n/I18nProvider'
import { useAuth } from '../../auth/AuthProvider'
import {
  Badge,
  ConfirmButton,
  ErrorBox,
  Field,
  PageHeader,
  Spinner,
  toast,
} from '../../components/ui'
import { SettingsNav } from '../../components/SettingsNav'
import { ExportCsvButton } from '../../components/ExportCsvButton'

const POLL_MS = 5_000

function exportBadge(s: ExportJobStatus): 'ok' | 'warn' | 'danger' | 'muted' | 'info' {
  switch (s) {
    case 'done':
      return 'ok'
    case 'failed':
      return 'danger'
    case 'running':
      return 'info'
    default:
      return 'muted'
  }
}

/** Settings -> Данни: CSV per dataset, the full export (zip, signed link), delete-my-data. */
export function DataSettingsPage() {
  const { t, dateTime, date, number } = useI18n()
  const { me, hasRole, refresh } = useAuth()
  const [jobs, setJobs] = useState<ExportJobDto[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const [password, setPassword] = useState('')
  const [deleteError, setDeleteError] = useState<unknown>(null)
  const isOwner = hasRole('owner')
  const tenant = me?.tenant ?? null
  const scheduled = tenant?.status === 'deletion_scheduled'

  const load = useCallback(async () => {
    try {
      setJobs((await get<{ items: ExportJobDto[] }>('/exports')).items)
      setError(null)
    } catch (e) {
      setError(e)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Poll while a run is queued / running (the worker finishes it in the background).
  const active = !!jobs?.some((j) => j.status === 'queued' || j.status === 'running')
  useEffect(() => {
    if (!active) return
    const h = setInterval(() => void load(), POLL_MS)
    return () => clearInterval(h)
  }, [active, load])

  const startFull = async () => {
    setBusy(true)
    try {
      await post<ExportJobDto>('/exports/full')
      toast(t('data.fullStarted'))
      await load()
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) toast(e.problem.title, 'error')
      else setError(e)
    } finally {
      setBusy(false)
    }
  }

  const requestDeletion = async () => {
    setDeleteError(null)
    try {
      const tn = await post<TenantDto>('/tenant/delete-request', { password })
      setPassword('')
      toast(t('data.deleteRequested', { date: tn.deletionAt ? date(tn.deletionAt) : '' }))
      await refresh()
    } catch (e) {
      setDeleteError(e)
    }
  }

  const cancelDeletion = async () => {
    setDeleteError(null)
    try {
      await post<TenantDto>('/tenant/delete-request/cancel')
      toast(t('data.deleteCancelled'))
      await refresh()
    } catch (e) {
      setDeleteError(e)
    }
  }

  return (
    <div>
      <PageHeader title={t('data.title')} subtitle={t('data.subtitle')} />
      <SettingsNav />
      {scheduled ? (
        <div className="alert alert-error deletion-alert" role="alert">
          <span>
            {t('data.deleteScheduled', { date: tenant?.deletionAt ? date(tenant.deletionAt) : '' })}
          </span>
          {isOwner ? (
            <ConfirmButton
              className="btn btn-danger"
              label={t('data.deleteCancel')}
              onConfirm={cancelDeletion}
            />
          ) : null}
        </div>
      ) : null}
      <div className="card">
        <h2>{t('data.csvTitle')}</h2>
        <p className="muted small">{t('data.csvHint')}</p>
        <div className="quick-links">
          {EXPORT_DATASETS.map((ds) => (
            <ExportCsvButton key={ds} dataset={ds} label={t(`data.dataset.${ds}`)} />
          ))}
        </div>
      </div>
      <div className="card">
        <div className="card-head">
          <h2>{t('data.fullTitle')}</h2>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || active}
            onClick={startFull}
          >
            {t('data.fullStart')}
          </button>
        </div>
        <p className="muted small">{t('data.fullHint')}</p>
        <ErrorBox error={error} />
        {!jobs ? (
          <Spinner />
        ) : jobs.length === 0 ? (
          <p className="muted">{t('data.noExports')}</p>
        ) : (
          <div className="table-wrap">
            <table className="table compact">
              <thead>
                <tr>
                  <th>{t('data.created')}</th>
                  <th>{t('data.status')}</th>
                  <th className="num">{t('data.size')}</th>
                  <th>{t('data.requestedBy')}</th>
                  <th>{t('data.expires')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id} className={j.status === 'failed' ? 'row-error' : ''}>
                    <td>{dateTime(j.createdAt)}</td>
                    <td>
                      <Badge kind={exportBadge(j.status)}>
                        {t(`enum.exportStatus.${j.status}`)}
                      </Badge>
                      {j.error ? <div className="small text-danger">{j.error}</div> : null}
                    </td>
                    <td className="num">
                      {j.bytes != null
                        ? t('data.mb', {
                            value: number(j.bytes / 1_048_576, { maximumFractionDigits: 1 }),
                          })
                        : '—'}
                    </td>
                    <td>{j.requestedByName ?? <span className="muted">—</span>}</td>
                    <td>{j.expiresAt ? dateTime(j.expiresAt) : '—'}</td>
                    <td className="num">
                      {j.downloadUrl ? (
                        <a className="btn btn-small btn-primary" href={serverPath(j.downloadUrl)}>
                          {t('data.download')}
                        </a>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="card delete-card">
        <h2 className="text-danger">{t('data.deleteTitle')}</h2>
        <p>{t('data.deleteWhat')}</p>
        <p>{t('data.deleteGrace', { days: TENANT_DELETION_GRACE_DAYS })}</p>
        <p>
          <strong>{t('data.deleteExportFirst')}</strong>
        </p>
        {!isOwner ? (
          <p className="muted small">{t('data.deleteOwnerOnly')}</p>
        ) : scheduled ? null : (
          <form
            className="delete-form"
            onSubmit={(e) => {
              e.preventDefault()
            }}
          >
            <Field label={t('data.deletePassword')}>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <ErrorBox error={deleteError} />
            <ConfirmButton
              label={t('data.deleteRequest')}
              disabled={password.length === 0}
              onConfirm={requestDeletion}
            />
          </form>
        )}
        {scheduled && isOwner ? <ErrorBox error={deleteError} /> : null}
      </div>
    </div>
  )
}
