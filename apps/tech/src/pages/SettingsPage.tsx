import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { useApp } from '../app/AppProvider'
import { destroySession } from '../app/session'
import { useToast } from '../components/Toast'
import { Field, PageHeader } from '../components/ui'
import { db, setMeta } from '../db'
import { useI18n } from '../i18n/I18nProvider'
import { effectiveApiBase } from '../platform/http'
import { APP_VERSION } from '../version'

export function SettingsPage() {
  const { t, locale, locales, setLocale } = useI18n()
  const app = useApp()
  const toast = useToast()
  const navigate = useNavigate()
  const elevators = useLiveQuery(() => db.elevators.count(), [], 0)
  const buildings = useLiveQuery(() => db.buildings.count(), [], 0)
  const [deviceName, setDeviceName] = useState(app.meta.deviceName ?? '')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setDeviceName(app.meta.deviceName ?? '')
  }, [app.meta.deviceName])

  const saveDeviceName = () => {
    const name = deviceName.trim()
    if (!name || name === app.meta.deviceName) return
    void setMeta('deviceName', name).then(() => toast.show(t('common.saved')))
  }

  const logout = async () => {
    if (busy) return
    if (app.pendingCount > 0) {
      toast.show(t('tech.settings.logoutBlocked', { count: app.pendingCount }), { tone: 'error' })
      return
    }
    if (!window.confirm(t('tech.settings.logoutConfirm'))) return
    setBusy(true)
    try {
      await destroySession()
      app.refreshSession()
      navigate('/enroll', { replace: true })
    } finally {
      setBusy(false)
    }
  }

  const persisted = app.meta.storagePersisted

  return (
    <>
      <PageHeader title={t('tech.settings.title')} />
      <div className="page">
        <div className="card">
          <dl className="kv">
            <dt>{t('tech.settings.user')}</dt>
            <dd>{app.user?.name ?? '—'}</dd>
            <dt>{t('tech.settings.tenant')}</dt>
            <dd>{app.tenant?.name ?? '—'}</dd>
            <dt>{t('tech.settings.version')}</dt>
            <dd>{APP_VERSION}</dd>
            <dt>{t('tech.settings.storage')}</dt>
            <dd>
              {persisted === undefined
                ? '—'
                : persisted
                  ? t('tech.settings.storagePersistent')
                  : t('tech.settings.storageBestEffort')}
              <div className="muted small">
                {t('tech.settings.counts', { elevators, buildings })}
              </div>
            </dd>
            <dt>{t('tech.enroll.apiBase')}</dt>
            <dd className="muted small">{effectiveApiBase() || '/'}</dd>
          </dl>
        </div>

        <div className="card">
          <Field label={t('tech.settings.deviceName')}>
            <input
              type="text"
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              onBlur={saveDeviceName}
              maxLength={80}
            />
          </Field>
          <Field label={t('tech.settings.language')}>
            <select value={locale} onChange={(e) => setLocale(e.target.value)}>
              {locales.map((l) => (
                <option key={l} value={l}>
                  {t(`lang.${l}`)}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="card">
          <p className="muted small">{t('tech.settings.logoutHint')}</p>
          <button
            type="button"
            className="btn btn-danger btn-block"
            disabled={busy}
            onClick={() => void logout()}
          >
            {t('tech.settings.logout')}
          </button>
        </div>
      </div>
    </>
  )
}
