import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import type { AdminTenantDto } from '@avroleva/contracts'
import { get } from '../../lib/api'
import { useI18n } from '../../i18n/I18nProvider'
import { Badge, Empty, ErrorBox, PageHeader, Spinner } from '../../components/ui'

export function tenantStatusBadge(status: AdminTenantDto['status']) {
  return status === 'active'
    ? 'ok'
    : status === 'read_only' || status === 'deletion_scheduled'
      ? 'warn'
      : 'danger'
}

export function AdminTenantsPage() {
  const { t, date } = useI18n()
  const [items, setItems] = useState<AdminTenantDto[] | null>(null)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    get<{ items: AdminTenantDto[] }>('/admin/tenants')
      .then((r) => setItems(r.items))
      .catch(setError)
  }, [])

  if (error) return <ErrorBox error={error} />
  if (!items) return <Spinner />

  return (
    <div>
      <PageHeader
        title={t('admin.tenants')}
        actions={
          <Link className="btn btn-primary" to="/admin/tenants/new">
            {t('admin.registerTenant')}
          </Link>
        }
      />
      {items.length === 0 ? (
        <Empty />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('admin.company')}</th>
                <th>{t('settings.eik')}</th>
                <th>{t('admin.status')}</th>
                <th>{t('common.language')}</th>
                <th className="num">{t('nav.users')}</th>
                <th className="num">{t('nav.buildings')}</th>
                <th className="num">{t('nav.elevators')}</th>
                <th className="num">{t('nav.contracts')}</th>
                <th>{t('admin.createdAt')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((tn) => (
                <tr key={tn.id}>
                  <td>
                    <Link to={`/admin/tenants/${tn.id}`}>{tn.name}</Link>
                  </td>
                  <td>{tn.eik}</td>
                  <td>
                    <Badge kind={tenantStatusBadge(tn.status)}>
                      {t(`enum.tenantStatus.${tn.status}`)}
                    </Badge>
                    {tn.status === 'deletion_scheduled' && tn.deletionAt ? (
                      <span className="muted small"> {date(tn.deletionAt)}</span>
                    ) : null}
                  </td>
                  <td>{t(`lang.${tn.locale}`)}</td>
                  <td className="num">{tn.counts.users}</td>
                  <td className="num">{tn.counts.buildings}</td>
                  <td className="num">{tn.counts.elevators}</td>
                  <td className="num">{tn.counts.contracts}</td>
                  <td>{date(tn.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
