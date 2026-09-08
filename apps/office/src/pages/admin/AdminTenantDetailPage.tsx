import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import type { AdminTenantDto, UserDto } from '@avroleva/contracts'
import { get, patch, post } from '../../lib/api'
import { useI18n } from '../../i18n/I18nProvider'
import { Badge, ConfirmButton, ErrorBox, PageHeader, Spinner, toast } from '../../components/ui'
import { tenantStatusBadge } from './AdminTenantsPage'

export function AdminTenantDetailPage() {
  const { id } = useParams()
  const { t, date, dateTime } = useI18n()
  const [data, setData] = useState<{ tenant: AdminTenantDto; users: UserDto[] } | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [pwFor, setPwFor] = useState<string | null>(null)
  const [pw, setPw] = useState('')

  const load = useCallback(
    () =>
      get<{ tenant: AdminTenantDto; users: UserDto[] }>(`/admin/tenants/${id}`)
        .then(setData)
        .catch(setError),
    [id],
  )
  useEffect(() => {
    void load()
  }, [load])

  if (error) return <ErrorBox error={error} />
  if (!data) return <Spinner />
  const { tenant, users } = data

  const setStatus = async (status: AdminTenantDto['status']) => {
    try {
      await patch(`/admin/tenants/${tenant.id}`, { status })
      toast(t('common.saved'))
      await load()
    } catch (e) {
      setError(e)
    }
  }

  const cancelDeletion = async () => {
    try {
      await post(`/admin/tenants/${tenant.id}/cancel-deletion`)
      toast(t('admin.deletionCancelled'))
      await load()
    } catch (e) {
      setError(e)
    }
  }

  const scheduled = tenant.status === 'deletion_scheduled'

  return (
    <div>
      <PageHeader
        back={
          <Link to="/admin" className="back">
            {t('admin.tenants')}
          </Link>
        }
        title={tenant.name}
        actions={
          scheduled ? (
            <ConfirmButton label={t('admin.cancelDeletion')} onConfirm={cancelDeletion} />
          ) : tenant.status === 'active' ? (
            <button
              type="button"
              className="btn btn-danger-outline"
              onClick={() => setStatus('closed')}
            >
              {t('admin.deactivate')}
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={() => setStatus('active')}>
              {t('admin.reactivate')}
            </button>
          )
        }
      />
      {scheduled ? (
        <div className="alert alert-error deletion-alert" role="alert">
          {t('admin.deletionScheduled', { date: tenant.deletionAt ? date(tenant.deletionAt) : '' })}
        </div>
      ) : null}
      <div className="grid-2">
        <div className="card">
          <h2>{t('admin.company')}</h2>
          <dl className="dl">
            <dt>{t('admin.status')}</dt>
            <dd>
              <Badge kind={tenantStatusBadge(tenant.status)}>
                {t(`enum.tenantStatus.${tenant.status}`)}
              </Badge>
            </dd>
            {scheduled ? (
              <>
                <dt>{t('admin.deletionAt')}</dt>
                <dd className="text-danger">{tenant.deletionAt ? date(tenant.deletionAt) : '—'}</dd>
              </>
            ) : null}
            <dt>{t('settings.eik')}</dt>
            <dd>{tenant.eik}</dd>
            <dt>{t('settings.address')}</dt>
            <dd>{tenant.address}</dd>
            <dt>{t('settings.phone')}</dt>
            <dd>{tenant.phone}</dd>
            <dt>{t('settings.emergencyPhone')}</dt>
            <dd>{tenant.emergencyPhone}</dd>
            <dt>{t('common.language')}</dt>
            <dd>{t(`lang.${tenant.locale}`)}</dd>
            <dt>{t('admin.createdAt')}</dt>
            <dd>{date(tenant.createdAt)}</dd>
          </dl>
        </div>
        <div className="card">
          <h2>{t('admin.counts')}</h2>
          <dl className="dl">
            <dt>{t('nav.users')}</dt>
            <dd>{tenant.counts.users}</dd>
            <dt>{t('nav.customers')}</dt>
            <dd>{tenant.counts.customers}</dd>
            <dt>{t('nav.buildings')}</dt>
            <dd>{tenant.counts.buildings}</dd>
            <dt>{t('nav.elevators')}</dt>
            <dd>{tenant.counts.elevators}</dd>
            <dt>{t('nav.contracts')}</dt>
            <dd>{tenant.counts.contracts}</dd>
          </dl>
        </div>
      </div>
      <div className="card">
        <h2>{t('users.title')}</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('users.name')}</th>
                <th>{t('auth.username')}</th>
                <th>{t('users.role')}</th>
                <th>{t('users.status')}</th>
                <th>{t('users.lastLogin')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td>
                    <code>{u.username}</code>
                  </td>
                  <td>{t(`enum.userRole.${u.role}`)}</td>
                  <td>
                    <Badge kind={u.isActive ? 'ok' : 'muted'}>
                      {u.isActive ? t('users.active') : t('users.inactive')}
                    </Badge>
                  </td>
                  <td>{u.lastLoginAt ? dateTime(u.lastLoginAt) : '—'}</td>
                  <td className="actions">
                    <button
                      type="button"
                      className="btn btn-small"
                      onClick={() => setPwFor(pwFor === u.id ? null : u.id)}
                    >
                      {t('users.setPassword')}
                    </button>
                    {pwFor === u.id ? (
                      <form
                        className="inline-form-row"
                        onSubmit={async (e) => {
                          e.preventDefault()
                          try {
                            await post(`/admin/tenants/${tenant.id}/users/${u.id}/password`, {
                              password: pw,
                            })
                            toast(t('users.passwordSet'))
                            setPw('')
                            setPwFor(null)
                          } catch (err) {
                            setError(err)
                          }
                        }}
                      >
                        <input
                          type="password"
                          autoComplete="new-password"
                          placeholder={t('users.passwordHint')}
                          value={pw}
                          onChange={(e) => setPw(e.target.value)}
                        />
                        <button
                          type="submit"
                          className="btn btn-small btn-primary"
                          disabled={pw.length < 8}
                        >
                          {t('common.save')}
                        </button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
