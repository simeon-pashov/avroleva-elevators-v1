import { NavLink, Outlet, useNavigate } from 'react-router'
import { useAuth } from '../auth/AuthProvider'
import { useI18n } from '../i18n/I18nProvider'
import { LanguageSwitch } from './LanguageSwitch'
import { ToastHost } from './ui'

export function Shell() {
  const { me, logout, hasRole } = useAuth()
  const { t } = useI18n()
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
    { to: '/import', label: t('nav.import'), show: hasRole('owner', 'office') },
    { to: '/users', label: t('nav.users'), show: hasRole('owner') },
    { to: '/settings', label: t('nav.settings') },
  ]

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-name">{'Avroleva'}</span>
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
      <main className="content">
        <Outlet />
      </main>
      <ToastHost />
    </div>
  )
}
