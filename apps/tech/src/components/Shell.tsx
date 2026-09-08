import { NavLink, Outlet } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { useApp } from '../app/AppProvider'
import { useT } from '../i18n/I18nProvider'

function Tab({
  to,
  icon,
  label,
  badge,
  badgeTone,
  end,
}: {
  to: string
  icon: string
  label: string
  badge?: number
  badgeTone?: 'danger' | 'warn'
  end?: boolean
}) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>
      <span className="tab-icon" aria-hidden="true">
        {icon}
      </span>
      <span>{label}</span>
      {badge ? <span className={`tab-badge ${badgeTone ?? ''}`}>{badge}</span> : null}
    </NavLink>
  )
}

export function Shell() {
  const t = useT()
  const app = useApp()
  const callbackCount = useLiveQuery(() => db.callbacks.count(), [], 0)
  const showNewVersion = app.needRefresh && app.pendingCount === 0
  return (
    <div className="app">
      {!app.online ? <div className="banner banner-offline">{t('tech.offline')}</div> : null}
      {showNewVersion ? (
        <div className="banner banner-info">
          <span>{t('tech.newVersion')}</span>
          <button type="button" className="btn btn-sm btn-primary" onClick={app.applyUpdate}>
            {t('tech.reload')}
          </button>
        </div>
      ) : null}
      <main className="app-main">
        <Outlet />
      </main>
      <nav className="tabbar">
        <Tab to="/" icon="📋" label={t('tech.nav.today')} end />
        <Tab to="/callbacks" icon="🚨" label={t('tech.nav.callbacks')} badge={callbackCount} />
        <Tab
          to="/outbox"
          icon="📤"
          label={t('tech.nav.outbox')}
          badge={app.pendingCount + app.failedCount}
          badgeTone={app.failedCount ? 'danger' : 'warn'}
        />
        <Tab to="/settings" icon="⚙️" label={t('tech.nav.settings')} />
      </nav>
    </div>
  )
}
