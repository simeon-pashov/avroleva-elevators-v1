import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import type { BuildingDto, ContactDto, ContractDto, CustomerDto, Page } from '@avroleva/contracts'
import { del, get, qs } from '../../lib/api'
import { useI18n } from '../../i18n/I18nProvider'
import { useAuth } from '../../auth/AuthProvider'
import { Badge, ConfirmButton, ErrorBox, PageHeader, Spinner, toast } from '../../components/ui'
import { ContactsPanel } from './ContactsPanel'

export function CustomerDetailPage() {
  const { id } = useParams()
  const { t, date, money } = useI18n()
  const { hasRole } = useAuth()
  const canSeeMoney = hasRole('owner', 'office')
  const navigate = useNavigate()
  const [c, setC] = useState<CustomerDto | null>(null)
  const [buildings, setBuildings] = useState<BuildingDto[]>([])
  const [contacts, setContacts] = useState<ContactDto[]>([])
  const [contracts, setContracts] = useState<ContractDto[]>([])
  const [error, setError] = useState<unknown>(null)
  const canEdit = hasRole('owner', 'office')

  const load = useCallback(async () => {
    try {
      const [cust, b, ct, cr] = await Promise.all([
        get<CustomerDto>(`/customers/${id}`),
        get<Page<BuildingDto>>(`/buildings${qs({ customerId: id, limit: 200 })}`),
        get<Page<ContactDto>>(`/contacts${qs({ customerId: id, limit: 200 })}`),
        get<Page<ContractDto>>(`/contracts${qs({ customerId: id, limit: 200 })}`),
      ])
      setC(cust)
      setBuildings(b.items)
      setContacts(ct.items)
      setContracts(cr.items)
    } catch (e) {
      setError(e)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  if (error) return <ErrorBox error={error} />
  if (!c) return <Spinner />
  const dash = <span className="muted">—</span>

  return (
    <div>
      <PageHeader
        back={
          <Link to="/customers" className="back">
            {t('customers.title')}
          </Link>
        }
        title={c.name}
        actions={
          canEdit ? (
            <>
              <Link className="btn" to={`/customers/${c.id}/edit`}>
                {t('common.edit')}
              </Link>
              <Link className="btn btn-primary" to={`/buildings/new?customerId=${c.id}`}>
                {t('buildings.new')}
              </Link>
              {buildings.length === 0 ? (
                <ConfirmButton
                  label={t('common.archive')}
                  onConfirm={async () => {
                    await del(`/customers/${c.id}`)
                    toast(t('common.archived'))
                    navigate('/customers')
                  }}
                />
              ) : null}
            </>
          ) : null
        }
      />
      <div className="grid-2">
        <div className="card">
          <h2>{t('customers.details')}</h2>
          <dl className="dl">
            <dt>{t('customers.kind')}</dt>
            <dd>{t(`enum.customerKind.${c.kind}`)}</dd>
            <dt>{t('customers.eik')}</dt>
            <dd>{c.eik ?? dash}</dd>
            <dt>{t('customers.vatNo')}</dt>
            <dd>{c.vatNo ?? dash}</dd>
            <dt>{t('customers.billingAddress')}</dt>
            <dd>{c.billingAddress ?? dash}</dd>
            <dt>{t('customers.invoiceEmail')}</dt>
            <dd>{c.invoiceEmail ?? dash}</dd>
            <dt>{t('common.notes')}</dt>
            <dd className="pre">{c.notes ?? dash}</dd>
          </dl>
        </div>
        <ContactsPanel
          contacts={contacts}
          parent={{ customerId: c.id }}
          onChange={load}
          canEdit={canEdit}
        />
      </div>
      <div className="grid-2">
        <div className="card">
          <h2>{t('buildings.title')}</h2>
          {buildings.length === 0 ? (
            <p className="muted">{t('customers.noBuildings')}</p>
          ) : (
            <ul className="list">
              {buildings.map((b) => (
                <li key={b.id}>
                  <Link to={`/buildings/${b.id}`}>{b.addressText}</Link>{' '}
                  <span className="muted">
                    · {t('buildings.elevatorCount', { count: b.elevatorCount ?? 0 })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="card">
          <h2>{t('contracts.title')}</h2>
          {contracts.length === 0 ? (
            <p className="muted">{t('contracts.none')}</p>
          ) : (
            <ul className="list">
              {contracts.map((x) => (
                <li key={x.id}>
                  <Link to={`/contracts/${x.id}`}>{x.buildingAddressText}</Link>{' '}
                  <Badge kind={x.status === 'active' ? 'ok' : 'muted'}>
                    {t(`enum.contractStatus.${x.status}`)}
                  </Badge>{' '}
                  <span className="muted">
                    {date(x.startDate)}
                    {canSeeMoney
                      ? ` · ${money(x.monthlyTotalCents)} / ${t('contracts.month')}`
                      : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
