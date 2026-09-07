import { Link } from 'react-router'
import { useI18n } from '../i18n/I18nProvider'
import { useAuth } from '../auth/AuthProvider'
import { PageHeader } from '../components/ui'

/** Placeholder: step 2 adds the map with elevator pins, due today/tomorrow, payments widgets. */
export function DashboardPage() {
  const { t } = useI18n()
  const { me } = useAuth()
  return (
    <div>
      <PageHeader title={t('dashboard.title')} />
      <div className="card">
        <p>{t('dashboard.placeholder', { name: me?.user.name ?? '' })}</p>
        <p className="muted">{t('dashboard.comingSoon')}</p>
        <div className="quick-links">
          <Link className="btn" to="/buildings">
            {t('nav.buildings')}
          </Link>
          <Link className="btn" to="/elevators">
            {t('nav.elevators')}
          </Link>
          <Link className="btn" to="/import">
            {t('nav.import')}
          </Link>
        </div>
      </div>
    </div>
  )
}
