import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import type { CustomerDto, CustomerKind, Page } from '@avroleva/contracts'
import { CustomerKind as CustomerKindEnum } from '@avroleva/contracts'
import { get, qs } from '../../lib/api'
import { useI18n } from '../../i18n/I18nProvider'
import { useAuth } from '../../auth/AuthProvider'
import {
  Empty,
  ErrorBox,
  LoadMore,
  PageHeader,
  SearchBox,
  Spinner,
  useCursorList,
} from '../../components/ui'
import { EnumSelect } from '../../components/EnumSelect'

export function CustomersListPage() {
  const { t } = useI18n()
  const { hasRole } = useAuth()
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const [kind, setKind] = useState<CustomerKind | ''>('')
  const list = useCursorList<CustomerDto>(
    (cursor) => get<Page<CustomerDto>>(`/customers${qs({ q, kind, cursor, limit: 50 })}`),
    [q, kind],
  )

  return (
    <div>
      <PageHeader
        title={t('customers.title')}
        actions={
          hasRole('owner', 'office') ? (
            <Link className="btn btn-primary" to="/customers/new">
              {t('customers.new')}
            </Link>
          ) : null
        }
      />
      <div className="toolbar">
        <SearchBox
          value={q}
          onChange={(v) => setParams((p) => (v ? (p.set('q', v), p) : (p.delete('q'), p)))}
        />
        <EnumSelect
          value={kind}
          options={CustomerKindEnum.options}
          prefix="enum.customerKind"
          onChange={setKind}
          allowEmpty
          emptyLabel={t('customers.allKinds')}
        />
      </div>
      <ErrorBox error={list.error} />
      {list.loading && list.items.length === 0 ? (
        <Spinner />
      ) : list.items.length === 0 ? (
        <Empty />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('customers.name')}</th>
                <th>{t('customers.kind')}</th>
                <th>{t('customers.eik')}</th>
                <th className="num">{t('buildings.title')}</th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link to={`/customers/${c.id}`}>{c.name}</Link>
                  </td>
                  <td>{t(`enum.customerKind.${c.kind}`)}</td>
                  <td>{c.eik ?? <span className="muted">—</span>}</td>
                  <td className="num">{c.buildingCount ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <LoadMore hasMore={list.hasMore} loading={list.loading} onClick={list.loadMore} />
    </div>
  )
}
