import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import type {
  BuildingBillingDto,
  CallbackDto,
  DefectDto,
  ElevatorDto,
  InvoiceDto,
  InvoiceStatus,
  Page,
  PaymentDto,
  VisitDto,
  VisitKind,
} from '@avroleva/contracts'
import { BASE, get, qs, serverPath } from '../lib/api'
import { useI18n } from '../i18n/I18nProvider'
import { useAuth } from '../auth/AuthProvider'
import { Badge, Empty, ErrorBox, LoadMore, Spinner, useCursorList } from './ui'
import { CallbackList } from './callbacks/CallbackList'
import { CallbackIntakeForm } from './callbacks/CallbackIntakeForm'
import { DefectList } from './defects/DefectList'
import { RecordDefectForm } from './defects/RecordDefectForm'
import { ElevatorInspections } from './inspections/ElevatorInspections'

export function invoiceStatusBadge(status: InvoiceStatus): 'ok' | 'warn' | 'danger' | 'muted' {
  switch (status) {
    case 'paid':
      return 'ok'
    case 'issued':
      return 'warn'
    case 'overdue':
      return 'danger'
    default:
      return 'muted'
  }
}

export function visitKindBadge(kind: VisitKind): 'ok' | 'warn' | 'danger' | 'muted' | 'info' {
  switch (kind) {
    case 'functional_check':
      return 'ok'
    case 'technical_maintenance':
      return 'info'
    case 'repair':
      return 'warn'
    case 'callback':
      return 'danger'
    default:
      return 'muted'
  }
}

/** Visit list of one elevator, newest first, with a cursor. */
export function VisitHistory({ elevatorId, version }: { elevatorId: string; version: number }) {
  const { t, dateTime } = useI18n()
  const list = useCursorList<VisitDto>(
    (cursor) => get<Page<VisitDto>>(`/elevators/${elevatorId}/visits${qs({ cursor, limit: 20 })}`),
    [elevatorId, version],
  )
  return (
    <div>
      <ErrorBox error={list.error} />
      {list.loading && list.items.length === 0 ? (
        <Spinner />
      ) : list.items.length === 0 ? (
        <Empty text={t('visits.empty')} />
      ) : (
        <ul className="list visit-list">
          {list.items.map((v) => (
            <li key={v.id} className={v.supersededAt ? 'muted' : ''}>
              <div className="visit-head">
                <strong>{dateTime(v.startedAt)}</strong>
                <Badge kind={visitKindBadge(v.kind)}>{t(`enum.visitKind.${v.kind}`)}</Badge>
                <span className="muted small">{t(`enum.visitSource.${v.source}`)}</span>
              </div>
              <div className="small">
                <span className="muted">{t('visits.technicians')}: </span>
                {v.technicians.map((x) => x.name).join(', ')}
              </div>
              {v.checklist ? (
                <div className="small">
                  <span className="muted">{t('visits.checklist')}: </span>
                  {t('visits.checklistSummary', v.checklist.summary)}
                </div>
              ) : null}
              {v.qualityFlags.length ? (
                <div className="visit-flags">
                  {v.qualityFlags.map((f) => (
                    <Badge key={f} kind={f === 'pendingUploads' ? 'info' : 'warn'}>
                      {f === 'pendingUploads'
                        ? t('visits.pendingPhotos', {
                            count: v.attachments.filter((a) => !a.uploaded).length,
                          })
                        : t(`visits.flag.${f}`)}
                    </Badge>
                  ))}
                </div>
              ) : null}
              {v.notes ? <div className="pre small">{v.notes}</div> : null}
              {v.attachments.some((a) => a.uploaded) ? (
                <div className="thumbs">
                  {v.attachments
                    .filter((a) => a.uploaded && a.attachment)
                    .map((a) => (
                      <a
                        key={a.attachmentId}
                        href={serverPath(a.attachment!.url)}
                        target="_blank"
                        rel="noopener"
                        title={t(`enum.attachmentRole.${a.role}`)}
                        className={`thumb${a.role === 'logbook_page' ? ' thumb-logbook' : ''}`}
                      >
                        <img src={serverPath(a.attachment!.thumbUrl)} alt="" loading="lazy" />
                      </a>
                    ))}
                </div>
              ) : null}
              <div className="visit-actions small">
                <a href={`${BASE}/print/logbook/${v.id}`} target="_blank" rel="noopener">
                  {t('visits.logbookPage')}
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}
      <LoadMore hasMore={list.hasMore} loading={list.loading} onClick={list.loadMore} />
    </div>
  )
}

type InvoiceRow = InvoiceDto & { elevatorAmountCents?: number }

/** Compact invoice table shared by the elevator panel, the elevator page and the contract page. */
export function InvoicesTable({
  invoices,
  showElevatorShare,
  showBuilding,
}: {
  invoices: InvoiceRow[]
  showElevatorShare?: boolean
  showBuilding?: boolean
}) {
  const { t, date, money } = useI18n()
  const dash = <span className="muted">—</span>
  if (invoices.length === 0) return <p className="muted small">{t('payments.noInvoices')}</p>
  return (
    <div className="table-wrap">
      <table className="table compact">
        <thead>
          <tr>
            <th>{t('payments.invoiceNo')}</th>
            {showBuilding ? <th>{t('payments.building')}</th> : null}
            <th>{t('payments.period')}</th>
            {showElevatorShare ? <th className="num">{t('payments.elevatorShare')}</th> : null}
            <th className="num">{t('payments.total')}</th>
            <th>{t('payments.status')}</th>
            <th>{t('payments.dueAt')}</th>
            <th>{t('payments.paidOn')}</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => (
            <tr key={inv.id} className={inv.status === 'overdue' ? 'row-error' : ''}>
              <td>{inv.number}</td>
              {showBuilding ? (
                <td>
                  <Link to={`/buildings/${inv.buildingId}`}>{inv.buildingAddressText}</Link>
                </td>
              ) : null}
              <td>{inv.period}</td>
              {showElevatorShare ? (
                <td className="num">
                  {inv.elevatorAmountCents != null ? money(inv.elevatorAmountCents) : dash}
                </td>
              ) : null}
              <td className="num">{money(inv.totalCents)}</td>
              <td>
                <Badge kind={invoiceStatusBadge(inv.status)}>
                  {t(`enum.invoiceStatus.${inv.status}`)}
                </Badge>
                {inv.daysOverdue > 0 ? (
                  <Badge kind="danger">{t('payments.overdueBy', { count: inv.daysOverdue })}</Badge>
                ) : null}
              </td>
              <td>{date(inv.dueAt)}</td>
              <td>{inv.paidAt ? date(inv.paidAt) : dash}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function PaymentsTable({
  payments,
  showBuilding,
}: {
  payments: PaymentDto[]
  showBuilding?: boolean
}) {
  const { t, date, money } = useI18n()
  const dash = <span className="muted">—</span>
  if (payments.length === 0) return <p className="muted small">{t('payments.emptyHistory')}</p>
  return (
    <div className="table-wrap">
      <table className="table compact">
        <thead>
          <tr>
            <th>{t('payments.paidAt')}</th>
            {showBuilding ? <th>{t('payments.building')}</th> : null}
            <th>{t('payments.invoice')}</th>
            <th className="num">{t('payments.amount')}</th>
            <th>{t('payments.method')}</th>
            <th>{t('payments.note')}</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((p) => (
            <tr key={p.id}>
              <td>{date(p.paidAt)}</td>
              {showBuilding ? (
                <td>
                  <Link to={`/buildings/${p.buildingId}`}>{p.buildingAddressText}</Link>
                </td>
              ) : null}
              <td>
                {p.invoiceNumber != null ? `${t('payments.invoiceNo')} ${p.invoiceNumber}` : dash}
              </td>
              <td className="num">{money(p.amountCents)}</td>
              <td>{t(`enum.paymentMethod.${p.method}`)}</td>
              <td>{p.note ?? dash}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Invoices (with this elevator's share) and payments of the elevator's building. Owner/office only. */
export function ElevatorBilling({ elevatorId, version }: { elevatorId: string; version: number }) {
  const { t, moneyFull } = useI18n()
  const [b, setB] = useState<BuildingBillingDto | null>(null)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    let cancelled = false
    get<BuildingBillingDto>(`/elevators/${elevatorId}/billing`)
      .then((d) => !cancelled && setB(d))
      .catch((e) => !cancelled && setError(e))
    return () => {
      cancelled = true
    }
  }, [elevatorId, version])

  if (error) return <ErrorBox error={error} />
  if (!b) return <Spinner />
  return (
    <div>
      <div className="totals">
        <div className="total">
          <span className="muted small">{t('payments.pendingTotal')}</span>
          <strong>{moneyFull(b.pendingCents)}</strong>
        </div>
        <div className="total">
          <span className="muted small">{t('payments.overdueTotal')}</span>
          <strong className={b.overdueCents > 0 ? 'text-danger' : ''}>
            {moneyFull(b.overdueCents)}
          </strong>
        </div>
      </div>
      <h3 className="sub-head">{t('contracts.invoices')}</h3>
      <InvoicesTable invoices={b.invoices} showElevatorShare />
      <h3 className="sub-head">{t('payments.paymentsList')}</h3>
      <PaymentsTable payments={b.payments} />
    </div>
  )
}

/** Callbacks of one elevator with the intake form. */
export function ElevatorCallbacks({
  elevator,
  version,
  onChanged,
}: {
  elevator: ElevatorDto
  version: number
  onChanged: () => void
}) {
  const { t } = useI18n()
  const [adding, setAdding] = useState(false)
  const [local, setLocal] = useState(0)
  const list = useCursorList<CallbackDto>(
    (cursor) =>
      get<Page<CallbackDto>>(`/elevators/${elevator.id}/callbacks${qs({ cursor, limit: 20 })}`),
    [elevator.id, version, local],
  )
  const changed = () => {
    setLocal((v) => v + 1)
    onChanged()
  }
  return (
    <div>
      <div className="actions">
        <button
          type="button"
          className="btn btn-small btn-primary"
          onClick={() => setAdding((v) => !v)}
        >
          {t('callbacks.new')}
        </button>
      </div>
      {adding ? (
        <div className="inset">
          <CallbackIntakeForm
            elevator={elevator}
            onDone={() => {
              setAdding(false)
              changed()
            }}
            onCancel={() => setAdding(false)}
          />
        </div>
      ) : null}
      <ErrorBox error={list.error} />
      {list.loading && list.items.length === 0 ? (
        <Spinner />
      ) : (
        <CallbackList items={list.items} onChanged={changed} showElevator={false} />
      )}
      <LoadMore hasMore={list.hasMore} loading={list.loading} onClick={list.loadMore} />
    </div>
  )
}

/** Defects of one elevator with the record form. */
export function ElevatorDefects({
  elevator,
  version,
  onChanged,
}: {
  elevator: ElevatorDto
  version: number
  onChanged: () => void
}) {
  const { t } = useI18n()
  const [adding, setAdding] = useState(false)
  const [local, setLocal] = useState(0)
  const list = useCursorList<DefectDto>(
    (cursor) =>
      get<Page<DefectDto>>(`/elevators/${elevator.id}/defects${qs({ cursor, limit: 20 })}`),
    [elevator.id, version, local],
  )
  const changed = () => {
    setLocal((v) => v + 1)
    onChanged()
  }
  return (
    <div>
      <div className="actions">
        <button
          type="button"
          className="btn btn-small btn-primary"
          onClick={() => setAdding((v) => !v)}
        >
          {t('defects.new')}
        </button>
      </div>
      {adding ? (
        <div className="inset">
          <RecordDefectForm
            elevator={elevator}
            onDone={() => {
              setAdding(false)
              changed()
            }}
            onCancel={() => setAdding(false)}
          />
        </div>
      ) : null}
      <ErrorBox error={list.error} />
      {list.loading && list.items.length === 0 ? (
        <Spinner />
      ) : (
        <DefectList items={list.items} onChanged={changed} showElevator={false} />
      )}
      <LoadMore hasMore={list.hasMore} loading={list.loading} onClick={list.loadMore} />
    </div>
  )
}

type Tab = 'history' | 'callbacks' | 'defects' | 'inspections' | 'payments'

/**
 * "История" / "Аварии" / "Дефекти" / "Прегледи" / "Плащания" tabs of one elevator; the payments
 * tab exists only for owner/office. `onChanged` lets the host refresh (status, dates, pins).
 */
export function ElevatorTabs({
  elevator,
  version,
  onChanged,
  initial,
}: {
  elevator: ElevatorDto
  version: number
  onChanged?: () => void
  initial?: Tab
}) {
  const { t } = useI18n()
  const { hasRole } = useAuth()
  const showBilling = hasRole('owner', 'office')
  const [tab, setTab] = useState<Tab>(initial ?? 'history')
  const changed = onChanged ?? (() => undefined)
  const tabs: Array<{ key: Tab; label: string; show?: boolean }> = [
    { key: 'history', label: t('visits.history') },
    { key: 'callbacks', label: t('elevators.callbacks') },
    { key: 'defects', label: t('elevators.defects') },
    { key: 'inspections', label: t('elevators.inspections') },
    { key: 'payments', label: t('payments.title'), show: showBilling },
  ]
  return (
    <div className="tabs-block">
      <div className="tabs" role="tablist">
        {tabs
          .filter((x) => x.show !== false)
          .map((x) => (
            <button
              key={x.key}
              type="button"
              role="tab"
              aria-selected={tab === x.key}
              className={`tab${tab === x.key ? ' active' : ''}`}
              onClick={() => setTab(x.key)}
            >
              {x.label}
            </button>
          ))}
      </div>
      {tab === 'payments' && showBilling ? (
        <ElevatorBilling elevatorId={elevator.id} version={version} />
      ) : tab === 'callbacks' ? (
        <ElevatorCallbacks elevator={elevator} version={version} onChanged={changed} />
      ) : tab === 'defects' ? (
        <ElevatorDefects elevator={elevator} version={version} onChanged={changed} />
      ) : tab === 'inspections' ? (
        <ElevatorInspections elevator={elevator} version={version} onChanged={changed} />
      ) : (
        <VisitHistory elevatorId={elevator.id} version={version} />
      )}
    </div>
  )
}
