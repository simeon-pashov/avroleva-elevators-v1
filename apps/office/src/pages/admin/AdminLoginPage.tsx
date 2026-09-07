import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { useAdminAuth } from '../../auth/AdminAuthProvider'
import { useI18n } from '../../i18n/I18nProvider'
import { LanguageSwitch } from '../../components/LanguageSwitch'
import { ErrorBox, Field, Spinner } from '../../components/ui'

export function AdminLoginPage() {
  const { admin, loading, login } = useAdminAuth()
  const { t } = useI18n()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  if (loading) return <Spinner />
  if (admin) return <Navigate to="/admin" replace />

  return (
    <div className="login-page admin">
      <form
        className="login-card"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setError(null)
          try {
            await login(username, password)
            navigate('/admin', { replace: true })
          } catch (err) {
            setError(err)
          } finally {
            setBusy(false)
          }
        }}
      >
        <div className="login-head">
          <h1>{t('admin.title')}</h1>
          <LanguageSwitch />
        </div>
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
      </form>
    </div>
  )
}
