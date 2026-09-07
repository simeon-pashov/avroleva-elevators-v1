import { NavLink, Outlet, useNavigate } from 'react-router'
import { useAdminAuth } from '../../auth/AdminAuthProvider'
import { useI18n } from '../../i18n/I18nProvider'
import { LanguageSwitch } from '../../components/LanguageSwitch'
import { ToastHost } from '../../components/ui'

export function AdminShell() {
  const { admin, logout } = useAdminAuth()
  const { t } = useI18n()
  const navigate = useNavigate()
  return (
    <div className="shell admin">
      <header className="topbar">
        <div className="brand">
          <span className="brand-name">{'Avroleva'}</span>
          <span className="brand-tenant">{t('admin.title')}</span>
        </div>
        <nav className="nav">
          <NavLink to="/admin" end className={({ isActive }) => (isActive ? 'active' : '')}>
            {t('admin.tenants')}
          </NavLink>
          <NavLink to="/admin/tenants/new" className={({ isActive }) => (isActive ? 'active' : '')}>
            {t('admin.registerTenant')}
          </NavLink>
        </nav>
        <div className="topbar-right">
          <LanguageSwitch />
          <span className="user-name">{admin?.username}</span>
          <button
            type="button"
            className="btn btn-small"
            onClick={async () => {
              await logout()
              navigate('/admin/login')
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
