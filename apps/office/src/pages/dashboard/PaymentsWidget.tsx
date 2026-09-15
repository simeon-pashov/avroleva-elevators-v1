import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Link } from 'react-router'
import type {
  BillingSummaryDto,
  BuildingDto,
  GenerateInvoicesResultDto,
  InvoiceDto,
  Page,
  NewPaymentMethod,
  PaymentDto,
} from '@avroleva/contracts'
import { NewPaymentMethod as NewPaymentMethodEnum } from '@avroleva/contracts'
import { ApiError, get, post, qs } from '../../lib/api'
import { currentMonthSofia, todaySofia } from '../../lib/dates'
import { useI18n } from '../../i18n/I18nProvider'
import {
  Badge,
  Empty,
  ErrorBox,
  Field,
  LoadMore,
  Spinner,
  toast,
  useCursorList,
} from '../../components/ui'
import { EnumSelect } from '../../components/EnumSelect'
import { InvoicesTable, PaymentsTable } from '../../components/ElevatorTabs'

/** "Отбележи като платено": paid date, method, optional note; the amount defaults to the open balance. */
function PayForm({
  invoice,
  onDone,
  onCancel,
}: {
  invoice: InvoiceDto
  onDone: () => void
  onCancel: () => void
}) {
  const { t, moneyFull } = useI18n()
  const [paidAt, setPaidAt] = useState(todaySofia)
  const [method, setMethod] = useState<NewPaymentMethod>('bank')
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setErrors({})
    try {
      await post(`/billing/invoices/${invoice.id}/pay`, {
        paidAt,
        method,
        note: note.trim() || null,
      })
      toast(t('payments.recorded'))
      onDone()
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) setErrors(err.fieldErrors)
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="pay-form" onSubmit={submit}>
      <ErrorBox error={error} />
      <div className="row">
        <Field label={t('payments.paidAt')} error={errors.paidAt} required>
          <input
            type="date"
            value={paidAt}
            max={todaySofia()}
            onChange={(e) => setPaidAt(e.target.value)}
            required
          />
        </Field>
        <Field label={t('payments.method')} error={errors.method} hint={t('payments.nonCashOnly')}>
          <EnumSelect
            value={method}
            options={NewPaymentMethodEnum.options}
            prefix="enum.paymentMethod"
            onChange={(v) => v && setMethod(v)}
          />
        </Field>
        <Field label={t('payments.amount')}>
          <input value={moneyFull(invoice.openCents)} readOnly />
        </Field>
      </div>
      <Field label={t('payments.note')} error={errors.note}>
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      </Field>
      <div className="actions">
        <button type="submit" className="btn btn-primary btn-small" disabled={busy}>
          {t('payments.confirmPay')}
        </button>
        <button type="button" className="btn btn-small" onClick={onCancel} disabled={busy}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  )
}

function PendingInvoices({
  buildingId,
  version,
  onPaid,
}: {
  buildingId: string
  version: number
  onPaid: () => void
}) {
  const { t, date, moneyFull } = useI18n()
  const [paying, setPaying] = useState<string | null>(null)
  const list = useCursorList<InvoiceDto>(
    (cursor) =>
      get<Page<InvoiceDto>>(
        `/billing/invoices${qs({ pending: true, buildingId, cursor, limit: 20 })}`,
      ),
    [buildingId, version],
  )
  const dash = <span className="muted">—</span>
  return (
    <div>
      <p className="muted small">{t('payments.pendingHint')}</p>
      <ErrorBox error={list.error} />
      {list.loading && list.items.length === 0 ? (
        <Spinner />
      ) : list.items.length === 0 ? (
        <Empty text={t('payments.emptyPending')} />
      ) : (
        <div className="table-wrap">
          <table className="table compact">
            <thead>
              <tr>
                <th>{t('payments.invoiceNo')}</th>
                <th>{t('payments.building')}</th>
                <th>{t('payments.customer')}</th>
                <th>{t('payments.period')}</th>
                <th className="num">{t('payments.total')}</th>
                <th>{t('payments.dueAt')}</th>
                <th>{t('payments.daysOverdue')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.items.map((inv) => (
                <InvoiceRows
                  key={inv.id}
                  inv={inv}
                  paying={paying === inv.id}
                  onPay={() => setPaying(paying === inv.id ? null : inv.id)}
                  onPaid={() => {
                    setPaying(null)
                    onPaid()
                  }}
                  onCancel={() => setPaying(null)}
                  date={date}
                  moneyFull={moneyFull}
                  dash={dash}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <LoadMore hasMore={list.hasMore} loading={list.loading} onClick={list.loadMore} />
    </div>
  )
}

function InvoiceRows({
  inv,
  paying,
  onPay,
  onPaid,
  onCancel,
  date,
  moneyFull,
  dash,
}: {
  inv: InvoiceDto
  paying: boolean
  onPay: () => void
  onPaid: () => void
  onCancel: () => void
  date: (d: string) => string
  moneyFull: (c: number) => string
  dash: ReactNode
}) {
  const { t } = useI18n()
  return (
    <>
      <tr className={inv.daysOverdue > 0 ? 'row-error' : ''}>
        <td>{inv.number}</td>
        <td>
          <Link to={`/buildings/${inv.buildingId}`}>{inv.buildingAddressText}</Link>
        </td>
        <td>{inv.customerName ?? dash}</td>
        <td>{inv.period}</td>
        <td className="num">{moneyFull(inv.totalCents)}</td>
        <td>{date(inv.dueAt)}</td>
        <td>
          {inv.daysOverdue > 0 ? (
            <Badge kind="danger">{t('payments.overdueBy', { count: inv.daysOverdue })}</Badge>
          ) : (
            dash
          )}
        </td>
        <td>
          <button type="button" className="btn btn-small" onClick={onPay}>
            {t('payments.markPaid')}
          </button>
        </td>
      </tr>
      {paying ? (
        <tr className="row-form">
          <td colSpan={8}>
            <PayForm invoice={inv} onDone={onPaid} onCancel={onCancel} />
          </td>
        </tr>
      ) : null}
    </>
  )
}

function PaymentsHistory({
  buildingId,
  month,
  version,
}: {
  buildingId: string
  month: string
  version: number
}) {
  const { t, moneyFull } = useI18n()
  const [payments, setPayments] = useState<PaymentDto[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const paid = useCursorList<InvoiceDto>(
    (cursor) =>
      get<Page<InvoiceDto>>(
        `/billing/invoices${qs({ status: 'paid', month, buildingId, cursor, limit: 20 })}`,
      ),
    [buildingId, month, version],
  )

  useEffect(() => {
    let cancelled = false
    get<{ items: PaymentDto[] }>(`/billing/payments${qs({ month, buildingId })}`)
      .then((r) => !cancelled && setPayments(r.items))
      .catch((e) => !cancelled && setError(e))
    return () => {
      cancelled = true
    }
  }, [buildingId, month, version])

  const total = (payments ?? []).reduce((sum, p) => sum + p.amountCents, 0)
  return (
    <div>
      <ErrorBox error={error} />
      <div className="totals">
        <div className="total">
          <span className="muted small">{t('payments.monthTotal', { month })}</span>
          <strong className="text-ok">{moneyFull(total)}</strong>
        </div>
      </div>
      <h3 className="sub-head">{t('payments.paymentsList')}</h3>
      {payments === null && !error ? (
        <Spinner />
      ) : (
        <PaymentsTable payments={payments ?? []} showBuilding />
      )}
      <h3 className="sub-head">{t('payments.paidInvoices')}</h3>
      <ErrorBox error={paid.error} />
      {paid.loading && paid.items.length === 0 ? (
        <Spinner />
      ) : (
        <InvoicesTable invoices={paid.items} showBuilding />
      )}
      <LoadMore hasMore={paid.hasMore} loading={paid.loading} onClick={paid.loadMore} />
    </div>
  )
}

/** "Плащания" (owner/office only): totals, building + month filters, pending / history tabs. */
export function PaymentsWidget({ version, onChanged }: { version: number; onChanged: () => void }) {
  const { t, moneyFull } = useI18n()
  const [buildingId, setBuildingId] = useState('')
  const [month, setMonth] = useState(currentMonthSofia)
  const [tab, setTab] = useState<'pending' | 'history'>('pending')
  const [buildings, setBuildings] = useState<BuildingDto[]>([])
  const [summary, setSummary] = useState<BillingSummaryDto | null>(null)
  const [summaryError, setSummaryError] = useState<unknown>(null)
  const [generating, setGenerating] = useState(false)

  // Month-end: one invoice per active contract for the selected month (idempotent on the API).
  const generate = async () => {
    if (!window.confirm(t('payments.generateConfirm', { month }))) return
    setGenerating(true)
    try {
      const r = await post<GenerateInvoicesResultDto>('/billing/invoices/generate', {
        period: month,
      })
      toast(t('payments.generated', { created: r.created, skipped: r.skipped }))
      onChanged()
    } catch (err) {
      setSummaryError(err)
    } finally {
      setGenerating(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    get<Page<BuildingDto>>('/buildings?limit=200')
      .then((r) => !cancelled && setBuildings(r.items))
      .catch(() => {
        /* the filter is optional */
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    get<BillingSummaryDto>(`/billing/summary${qs({ month })}`)
      .then((s) => {
        if (cancelled) return
        setSummary(s)
        setSummaryError(null)
      })
      .catch((e) => !cancelled && setSummaryError(e))
    return () => {
      cancelled = true
    }
  }, [month, version])

  return (
    <div className="card payments-widget">
      <div className="card-head">
        <h2>{t('payments.title')}</h2>
        <Link className="small" to="/invoices">
          {t('payments.allInvoices')}
        </Link>
      </div>
      <ErrorBox error={summaryError} />
      {summary ? (
        <div className="totals">
          <div className="total">
            <span className="muted small">{t('payments.pendingTotal')}</span>
            <strong>{moneyFull(summary.pendingCents)}</strong>
            <span className="muted small">
              {t('payments.invoicesCount', { count: summary.pendingCount })}
            </span>
          </div>
          <div className="total">
            <span className="muted small">{t('payments.overdueTotal')}</span>
            <strong className={summary.overdueCents > 0 ? 'text-danger' : ''}>
              {moneyFull(summary.overdueCents)}
            </strong>
            <span className="muted small">
              {t('payments.invoicesCount', { count: summary.overdueCount })}
            </span>
          </div>
          <div className="total">
            <span className="muted small">{t('payments.paidThisMonth')}</span>
            <strong className="text-ok">{moneyFull(summary.paidThisMonthCents)}</strong>
            <span className="muted small">
              {t('payments.invoicesCount', { count: summary.paidThisMonthCount })}
            </span>
          </div>
        </div>
      ) : null}
      <div className="toolbar">
        <select
          value={buildingId}
          onChange={(e) => setBuildingId(e.target.value)}
          aria-label={t('payments.building')}
        >
          <option value="">{t('payments.allBuildings')}</option>
          {buildings.map((b) => (
            <option key={b.id} value={b.id}>
              {b.addressText}
            </option>
          ))}
        </select>
        <input
          type="month"
          value={month}
          onChange={(e) => e.target.value && setMonth(e.target.value)}
          aria-label={t('payments.month')}
        />
        <button type="button" className="btn btn-small" onClick={generate} disabled={generating}>
          {t('payments.generate')}
        </button>
      </div>
      <div className="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'pending'}
          className={`tab${tab === 'pending' ? ' active' : ''}`}
          onClick={() => setTab('pending')}
        >
          {t('payments.pending')}
          {summary ? <span className="tab-count">{summary.pendingCount}</span> : null}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'history'}
          className={`tab${tab === 'history' ? ' active' : ''}`}
          onClick={() => setTab('history')}
        >
          {t('payments.history')}
        </button>
      </div>
      {tab === 'pending' ? (
        <PendingInvoices buildingId={buildingId} version={version} onPaid={onChanged} />
      ) : (
        <PaymentsHistory buildingId={buildingId} month={month} version={version} />
      )}
    </div>
  )
}
