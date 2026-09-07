import { Link, useNavigate } from 'react-router'
import type { AdminTenantDto } from '@avroleva/contracts'
import { post } from '../../lib/api'
import { useI18n } from '../../i18n/I18nProvider'
import { ErrorBox, Field, PageHeader, toast } from '../../components/ui'
import { useForm } from '../../components/useForm'

interface FormValues {
  name: string
  eik: string
  address: string
  phone: string
  emergencyPhone: string
  email: string
  locale: string
  ownerName: string
  ownerUsername: string
  ownerPassword: string
  ownerEmail: string
}

export function AdminNewTenantPage() {
  const { t, locales } = useI18n()
  const navigate = useNavigate()
  const form = useForm<FormValues>({
    name: '',
    eik: '',
    address: '',
    phone: '',
    emergencyPhone: '',
    email: '',
    locale: 'bg',
    ownerName: '',
    ownerUsername: '',
    ownerPassword: '',
    ownerEmail: '',
  })
  const v = form.values
  const err = form.errors

  const save = () =>
    form.submit(async (values) => {
      const r = await post<{ tenant: AdminTenantDto }>('/admin/tenants', {
        name: values.name,
        eik: values.eik,
        address: values.address,
        phone: values.phone,
        emergencyPhone: values.emergencyPhone,
        email: values.email,
        locale: values.locale,
        owner: {
          name: values.ownerName,
          username: values.ownerUsername,
          password: values.ownerPassword,
          email: values.ownerEmail,
        },
      })
      toast(t('admin.registered'))
      navigate(`/admin/tenants/${r.tenant.id}`)
    })

  return (
    <div>
      <PageHeader
        back={
          <Link to="/admin" className="back">
            {t('admin.tenants')}
          </Link>
        }
        title={t('admin.registerTenant')}
      />
      <form
        className="grid-2"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <div className="card">
          <h2>{t('admin.company')}</h2>
          <Field label={t('settings.companyName')} required error={err.name}>
            <input value={v.name} onChange={(e) => form.set('name', e.target.value)} />
          </Field>
          <Field label={t('settings.eik')} required error={err.eik}>
            <input value={v.eik} onChange={(e) => form.set('eik', e.target.value)} />
          </Field>
          <Field label={t('settings.address')} required error={err.address}>
            <input value={v.address} onChange={(e) => form.set('address', e.target.value)} />
          </Field>
          <div className="row">
            <Field label={t('settings.phone')} required error={err.phone}>
              <input value={v.phone} onChange={(e) => form.set('phone', e.target.value)} />
            </Field>
            <Field label={t('settings.emergencyPhone')} required error={err.emergencyPhone}>
              <input
                value={v.emergencyPhone}
                onChange={(e) => form.set('emergencyPhone', e.target.value)}
              />
            </Field>
          </div>
          <div className="row">
            <Field label={t('contacts.email')} error={err.email}>
              <input
                type="email"
                value={v.email}
                onChange={(e) => form.set('email', e.target.value)}
              />
            </Field>
            <Field label={t('settings.tenantLocale')} error={err.locale}>
              <select value={v.locale} onChange={(e) => form.set('locale', e.target.value)}>
                {locales.map((l) => (
                  <option key={l} value={l}>
                    {t(`lang.${l}`)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </div>
        <div className="card">
          <h2>{t('admin.owner')}</h2>
          <p className="muted small">{t('admin.ownerHint')}</p>
          <Field label={t('users.name')} required error={err['owner.name']}>
            <input value={v.ownerName} onChange={(e) => form.set('ownerName', e.target.value)} />
          </Field>
          <Field
            label={t('auth.username')}
            required
            error={err['owner.username']}
            hint={t('users.usernameHint')}
          >
            <input
              autoComplete="off"
              value={v.ownerUsername}
              onChange={(e) => form.set('ownerUsername', e.target.value)}
            />
          </Field>
          <Field
            label={t('auth.password')}
            required
            error={err['owner.password']}
            hint={t('users.passwordHint')}
          >
            <input
              type="password"
              autoComplete="new-password"
              value={v.ownerPassword}
              onChange={(e) => form.set('ownerPassword', e.target.value)}
            />
          </Field>
          <Field label={t('contacts.email')} error={err['owner.email']}>
            <input
              type="email"
              value={v.ownerEmail}
              onChange={(e) => form.set('ownerEmail', e.target.value)}
            />
          </Field>
          <ErrorBox error={form.error} />
          <div className="actions">
            <button type="submit" className="btn btn-primary" disabled={form.busy}>
              {t('admin.register')}
            </button>
            <Link className="btn" to="/admin">
              {t('common.cancel')}
            </Link>
          </div>
        </div>
      </form>
    </div>
  )
}
