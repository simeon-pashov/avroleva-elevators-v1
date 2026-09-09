import { Link, NavLink, Outlet, useNavigate } from 'react-router'
import { useAuth } from '../auth/AuthProvider'
import { useI18n } from '../i18n/I18nProvider'
import { LanguageSwitch } from './LanguageSwitch'
import { NotificationsBell } from './NotificationsBell'
import { ToastHost } from './ui'

export function Shell() {
  const { me, logout, hasRole } = useAuth()
  const { t, date } = useI18n()
  const navigate = useNavigate()

  const items: Array<{ to: string; label: string; show?: boolean }> = [
    { to: '/', label: t('nav.dashboard') },
    { to: '/callbacks', label: t('nav.callbacks') },
    { to: '/defects', label: t('nav.defects') },
    { to: '/calendar', label: t('nav.calendar') },
    { to: '/buildings', label: t('nav.buildings') },
    { to: '/elevators', label: t('nav.elevators') },
    { to: '/customers', label: t('nav.customers') },
    { to: '/contracts', label: t('nav.contracts') },
    { to: '/invoices', label: t('nav.invoices'), show: hasRole('owner', 'office') },
    { to: '/reports', label: t('nav.reports'), show: hasRole('owner', 'office') },
    { to: '/notifications', label: t('nav.notifications'), show: hasRole('owner', 'office') },
    { to: '/import', label: t('nav.import'), show: hasRole('owner', 'office') },
    { to: '/users', label: t('nav.users'), show: hasRole('owner') },
    { to: '/settings', label: t('nav.settings') },
  ]
  const deletionAt = me?.tenant.status === 'deletion_scheduled' ? me.tenant.deletionAt : null
  const demoMode = !!me?.tenant.features.demoMode

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-name">{t('app.name')}</span>
          <span className="brand-tenant">{me?.tenant.name}</span>
        </div>
        <nav className="nav">
          {items
            .filter((i) => i.show !== false)
            .map((i) => (
              <NavLink
                key={i.to}
                to={i.to}
                end={i.to === '/'}
                className={({ isActive }) => (isActive ? 'active' : '')}
              >
                {i.label}
              </NavLink>
            ))}
        </nav>
        <div className="topbar-right">
          <NotificationsBell />
          <LanguageSwitch />
          <span className="user-name" title={me?.user.username}>
            {me?.user.name}
          </span>
          <button
            type="button"
            className="btn btn-small"
            onClick={async () => {
              await logout()
              navigate('/login')
            }}
          >
            {t('auth.logout')}
          </button>
        </div>
      </header>
      {demoMode ? (
        <div className="demo-banner" role="status">
          <strong>{t('shell.demoBadge')}</strong>
          <span>{t('shell.demoBanner')}</span>
        </div>
      ) : null}
      {deletionAt ? (
        <div className="deletion-banner" role="alert">
          <span>{t('shell.deletionBanner', { date: date(deletionAt) })}</span>
          {hasRole('owner') ? (
            <Link className="btn btn-small" to="/settings/data">
              {t('shell.deletionBannerLink')}
            </Link>
          ) : null}
        </div>
      ) : null}
      <main className="content">
        <Outlet />
      </main>
      <ToastHost />
    </div>
  )
}
