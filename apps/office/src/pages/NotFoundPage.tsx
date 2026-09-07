import { Link } from 'react-router'
import { useI18n } from '../i18n/I18nProvider'

export function NotFoundPage() {
  const { t } = useI18n()
  return (
    <div className="card">
      <h1>{t('error.pageNotFound')}</h1>
      <Link to="/">{t('nav.dashboard')}</Link>
    </div>
  )
}
