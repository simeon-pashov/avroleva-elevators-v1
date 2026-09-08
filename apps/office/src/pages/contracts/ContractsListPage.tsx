import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import type { ContractDto, ContractStatus, Page } from '@avroleva/contracts'
import { ContractStatus as ContractStatusEnum } from '@avroleva/contracts'
import { get, qs } from '../../lib/api'
import { useI18n } from '../../i18n/I18nProvider'
import { useAuth } from '../../auth/AuthProvider'
import {
  Badge,
  Empty,
  ErrorBox,
  LoadMore,
  PageHeader,
  SearchBox,
  Spinner,
  useCursorList,
} from '../../components/ui'
import { EnumSelect } from '../../components/EnumSelect'
import { ExportCsvButton } from '../../components/ExportCsvButton'

export function ContractsListPage() {
  const { t, date, moneyFull } = useI18n()
  const { hasRole } = useAuth()
  const canSeeMoney = hasRole('owner', 'office')
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const [status, setStatus] = useState<ContractStatus | ''>('active')
  const list = useCursorList<ContractDto>(
    (cursor) => get<Page<ContractDto>>(`/contracts${qs({ q, status, cursor, limit: 50 })}`),
    [q, status],
  )

  return (
    <div>
      <PageHeader
        title={t('contracts.title')}
        actions={
          hasRole('owner', 'office') ? (
            <>
              <ExportCsvButton dataset="contracts" />
              <Link className="btn btn-primary" to="/contracts/new">
                {t('contracts.new')}
              </Link>
            </>
          ) : null
        }
      />
      <div className="toolbar">
        <SearchBox
          value={q}
          onChange={(v) => setParams((p) => (v ? (p.set('q', v), p) : (p.delete('q'), p)))}
        />
        <EnumSelect
          value={status}
          options={ContractStatusEnum.options}
          prefix="enum.contractStatus"
          onChange={setStatus}
          allowEmpty
          emptyLabel={t('contracts.allStatuses')}
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
                <th>{t('buildings.address')}</th>
                <th>{t('contracts.customer')}</th>
                <th>{t('contracts.period')}</th>
                <th>{t('contracts.status')}</th>
                <th className="num">{t('contracts.elevators')}</th>
                {canSeeMoney ? <th className="num">{t('contracts.monthlyTotal')}</th> : null}
              </tr>
            </thead>
            <tbody>
              {list.items.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link to={`/contracts/${c.id}`}>{c.buildingAddressText}</Link>
                  </td>
                  <td>{c.customerName}</td>
                  <td>
                    {date(c.startDate)} – {c.endDate ? date(c.endDate) : '…'}
                  </td>
                  <td>
                    <Badge
                      kind={c.status === 'active' ? 'ok' : c.status === 'draft' ? 'warn' : 'muted'}
                    >
                      {t(`enum.contractStatus.${c.status}`)}
                    </Badge>
                  </td>
                  <td className="num">{c.lines.filter((l) => !l.toDate).length}</td>
                  {canSeeMoney ? <td className="num">{moneyFull(c.monthlyTotalCents)}</td> : null}
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
