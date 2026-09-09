import { useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { useAuth } from '../auth/AuthProvider'
import { useI18n } from '../i18n/I18nProvider'
import { LanguageSwitch } from '../components/LanguageSwitch'
import { ErrorBox, Field, Spinner } from '../components/ui'

export function LoginPage() {
  const { me, loading, login } = useAuth()
  const { t } = useI18n()
  const navigate = useNavigate()
  const location = useLocation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  if (loading) return <Spinner />
  if (me) return <Navigate to={(location.state as { from?: string } | null)?.from ?? '/'} replace />

  return (
    <div className="login-page">
      <form
        className="login-card"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setError(null)
          try {
            await login(username, password)
            navigate((location.state as { from?: string } | null)?.from ?? '/', { replace: true })
          } catch (err) {
            setError(err)
          } finally {
            setBusy(false)
          }
        }}
      >
        <div className="login-head">
          <h1>{t('app.name')}</h1>
          <LanguageSwitch />
        </div>
        <p className="muted">{t('auth.subtitle')}</p>
        <Field label={t('auth.username')} required>
          <input
            autoFocus
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </Field>
        <Field label={t('auth.password')} required>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <ErrorBox error={error} />
        <button
          className="btn btn-primary btn-block"
          type="submit"
          disabled={busy || !username || !password}
        >
          {t('auth.login')}
        </button>
        <p className="muted small login-admin-link">
          <a href={`${import.meta.env.BASE_URL.replace(/\/$/, '')}/admin/login`}>
            {t('auth.adminLink')}
          </a>
        </p>
      </form>
    </div>
  )
}
