import { NavLink } from 'react-router'
import { useAuth } from '../auth/AuthProvider'
import { useI18n } from '../i18n/I18nProvider'

/** Tabs at the top of every settings page: Общи · Фактуриране · Уведомления · Данни (all but the first owner/office). */
export function SettingsNav() {
  const { t } = useI18n()
  const { hasRole } = useAuth()
  const items = [
    { to: '/settings', label: t('settings.navGeneral'), show: true },
    { to: '/settings/billing', label: t('settings.navBilling'), show: hasRole('owner', 'office') },
    {
      to: '/settings/notifications',
      label: t('settings.navNotifications'),
      show: hasRole('owner', 'office'),
    },
    { to: '/settings/data', label: t('settings.navData'), show: hasRole('owner', 'office') },
    {
      to: '/settings/planning',
      label: t('settings.navPlanning'),
      show: hasRole('owner', 'office'),
    },
  ]
  return (
    <nav className="tabs settings-nav">
      {items
        .filter((i) => i.show)
        .map((i) => (
          <NavLink
            key={i.to}
            to={i.to}
            end
            className={({ isActive }) => `tab${isActive ? ' active' : ''}`}
          >
            {i.label}
          </NavLink>
        ))}
    </nav>
  )
}
