import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import type {
  BillingConfigDto,
  BuildingDto,
  BulkInvoiceResultDto,
  GenerateInvoicesResultDto,
  InvoiceDto,
  InvoiceStatus,
  Page,
  PaymentMethod,
} from '@avroleva/contracts'
import { PaymentMethod as PaymentMethodEnum } from '@avroleva/contracts'
import { get, post, qs } from '../../lib/api'
import { currentMonthSofia, todaySofia } from '../../lib/dates'
import { useI18n } from '../../i18n/I18nProvider'
import {
  Badge,
  Empty,
  ErrorBox,
  LoadMore,
  PageHeader,
  SearchBox,
  Spinner,
  toast,
  useCursorList,
} from '../../components/ui'
import { EnumSelect } from '../../components/EnumSelect'
import { invoiceStatusBadge } from '../../components/ElevatorTabs'

type Tone = 'ok' | 'warn' | 'danger' | 'muted' | 'info'

/** Badge tone per status from GET /billing/config (falls back to the fixed map). */
export function useInvoiceTones(config: BillingConfigDto | null) {
  return useMemo(() => {
    const m = new Map<string, Tone>()
    for (const s of config?.states ?? []) m.set(s.key, s.tone)
    return (status: InvoiceStatus): Tone => m.get(status) ?? invoiceStatusBadge(status)
  }, [config])
}

function csvCell(v: string | number | null | undefined): string {
  const s = v == null ? '' : String(v)
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** "Фактури": filters from the config, bulk remind / pay / CSV, "generate for month". */
export function InvoicesListPage() {
  const { t, date, moneyFull, money } = useI18n()
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const [status, setStatus] = useState<string>(params.get('status') ?? '')
  const [pending, setPending] = useState(params.get('pending') === '1')
  const [month, setMonth] = useState(params.get('month') ?? '')
  const [buildingId, setBuildingId] = useState(params.get('buildingId') ?? '')
  const [dunningStage, setDunningStage] = useState(params.get('dunningStage') ?? '')
  const [config, setConfig] = useState<BillingConfigDto | null>(null)
  const [buildings, setBuildings] = useState<BuildingDto[]>([])
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [genMonth, setGenMonth] = useState(currentMonthSofia)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<unknown>(null)
  const [payDate, setPayDate] = useState(todaySofia)
  const [payMethod, setPayMethod] = useState<PaymentMethod>('bank')
  const [payOpen, setPayOpen] = useState(false)
  const tone = useInvoiceTones(config)

  useEffect(() => {
    let cancelled = false
    get<BillingConfigDto>('/billing/config')
      .then((c) => !cancelled && setConfig(c))
      .catch(() => {
        /* the fixed tone map still works */
      })
    get<Page<BuildingDto>>('/buildings?limit=200')
      .then((r) => !cancelled && setBuildings(r.items))
      .catch(() => {
        /* the filter is optional */
      })
    return () => {
      cancelled = true
    }
  }, [])

  const list = useCursorList<InvoiceDto>(
    (cursor) =>
      get<Page<InvoiceDto>>(
        `/billing/invoices${qs({
          q,
          status: pending ? undefined : status,
          pending: pending ? true : undefined,
          month,
          buildingId,
          dunningStage,
          cursor,
          limit: 50,
        })}`,
      ),
    [q, status, pending, month, buildingId, dunningStage],
  )

  // Keep the selection to rows still on screen.
  useEffect(() => {
    setSelected((s) => {
      const ids = new Set(list.items.map((i) => i.id))
      const next = new Set([...s].filter((id) => ids.has(id)))
      return next.size === s.size ? s : next
    })
  }, [list.items])

  const allSelected = list.items.length > 0 && list.items.every((i) => selected.has(i.id))
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(list.items.map((i) => i.id)))
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const ids = [...selected]

  const bulk = async (body: {
    action: 'remind' | 'pay'
    ids: string[]
    paidAt?: string
    method?: PaymentMethod
  }) => {
    setBusy(true)
    setActionError(null)
    try {
      const r = await post<BulkInvoiceResultDto>('/billing/invoices/bulk', body)
      toast(
        t(r.action === 'pay' ? 'invoices.bulkPaid' : 'invoices.bulkReminded', {
          done: r.done,
          skipped: r.skipped,
        }),
      )
      setSelected(new Set())
      setPayOpen(false)
      list.reload()
    } catch (e) {
      setActionError(e)
    } finally {
      setBusy(false)
    }
  }

  const generate = async () => {
    if (!window.confirm(t('payments.generateConfirm', { month: genMonth }))) return
    setBusy(true)
    setActionError(null)
    try {
      const r = await post<GenerateInvoicesResultDto>('/billing/invoices/generate', {
        period: genMonth,
      })
      toast(t('payments.generated', { created: r.created, skipped: r.skipped }))
      list.reload()
    } catch (e) {
      setActionError(e)
    } finally {
      setBusy(false)
    }
  }

  const exportCsv = () => {
    const rows = list.items.filter((i) => selected.has(i.id))
    const header = [
      t('payments.invoiceNo'),
      t('invoices.reference'),
      t('payments.building'),
      t('payments.customer'),
      t('payments.period'),
      t('billing.doc.issuedAt'),
      t('payments.dueAt'),
      t('payments.total'),
      t('invoices.paid'),
      t('invoices.open'),
      t('payments.status'),
    ]
    const lines = rows.map((i) =>
      [
        i.number,
        i.paymentReference,
        i.buildingAddressText ?? '',
        i.customerName ?? '',
        i.period,
        i.issuedAt,
        i.dueAt,
        (i.totalCents / 100).toFixed(2),
        (i.paidCents / 100).toFixed(2),
        (i.openCents / 100).toFixed(2),
        t(`enum.invoiceStatus.${i.status}`),
      ]
        .map(csvCell)
        .join(';'),
    )
    const bom = String.fromCharCode(0xfeff)
    const blob = new Blob([bom, [header.map(csvCell).join(';'), ...lines].join('\r\n')], {
      type: 'text/csv;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `invoices-${todaySofia()}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }

  /** One setSearchParams call per change: consecutive functional calls would share the same base. */
  const setParamsMany = (changes: Record<string, string>) =>
    setParams((p) => {
      for (const [key, value] of Object.entries(changes)) {
        if (value) p.set(key, value)
        else p.delete(key)
      }
      return p
    })
  const setParam = (key: string, value: string) => setParamsMany({ [key]: value })
  const dash = <span className="muted">—</span>
  const states = config?.states ?? []

  return (
    <div>
      <PageHeader
        title={t('invoices.title')}
        subtitle={t('invoices.subtitle')}
        actions={
          <>
            <Link className="btn" to="/billing/bank-import">
              {t('invoices.bankImport')}
            </Link>
            <span className="inline-form-row">
              <input
                type="month"
                value={genMonth}
                onChange={(e) => e.target.value && setGenMonth(e.target.value)}
                aria-label={t('payments.month')}
              />
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void generate()}
              >
                {t('invoices.generateForMonth')}
              </button>
            </span>
          </>
        }
      />
      <div className="toolbar">
        <SearchBox
          value={q}
          onChange={(v) => setParam('q', v)}
          placeholder={t('invoices.searchPlaceholder')}
        />
        <select
          value={pending ? 'pending' : status}
          aria-label={t('payments.status')}
          onChange={(e) => {
            const val = e.target.value
            if (val === 'pending') {
              setPending(true)
              setStatus('')
            } else {
              setPending(false)
              setStatus(val)
            }
            setParamsMany({
              pending: val === 'pending' ? '1' : '',
              status: val === 'pending' ? '' : val,
            })
          }}
        >
          <option value="">{t('contracts.allStatuses')}</option>
          <option value="pending">{t('invoices.pendingFilter')}</option>
          {states.map((s) => (
            <option key={s.key} value={s.key}>
              {t(`enum.invoiceStatus.${s.key}`)}
            </option>
          ))}
        </select>
        <input
          type="month"
          value={month}
          aria-label={t('payments.month')}
          onChange={(e) => {
            setMonth(e.target.value)
            setParam('month', e.target.value)
          }}
        />
        <select
          value={buildingId}
          aria-label={t('payments.building')}
          onChange={(e) => {
            setBuildingId(e.target.value)
            setParam('buildingId', e.target.value)
          }}
        >
          <option value="">{t('payments.allBuildings')}</option>
          {buildings.map((b) => (
            <option key={b.id} value={b.id}>
              {b.addressText}
            </option>
          ))}
        </select>
        <select
          value={dunningStage}
          aria-label={t('invoices.dunningStage')}
          onChange={(e) => {
            setDunningStage(e.target.value)
            setParam('dunningStage', e.target.value)
          }}
        >
          <option value="">{t('invoices.anyDunning')}</option>
          {(config?.stages.length ? config.stages.map((s) => s.position) : [1, 2, 3]).map((n) => (
            <option key={n} value={n}>
              {t('invoices.dunningAtLeast', { n })}
            </option>
          ))}
        </select>
      </div>
      <ErrorBox error={actionError} />
      <ErrorBox error={list.error} />
      {selected.size > 0 ? (
        <div className="bulk-bar">
          <strong>{t('invoices.selectedCount', { count: selected.size })}</strong>
          <button
            type="button"
            className="btn btn-small"
            disabled={busy}
            onClick={() => void bulk({ action: 'remind', ids })}
          >
            {t('invoices.bulkRemind')}
          </button>
          <button
            type="button"
            className="btn btn-small"
            disabled={busy}
            onClick={() => setPayOpen((o) => !o)}
          >
            {t('invoices.bulkPay')}
          </button>
          <button type="button" className="btn btn-small" onClick={exportCsv}>
            {t('common.exportCsv')}
          </button>
          <button
            type="button"
            className="btn btn-small"
            onClick={() => setSelected(new Set())}
            disabled={busy}
          >
            {t('invoices.clearSelection')}
          </button>
          {payOpen ? (
            <span className="inline-form-row">
              <input
                type="date"
                value={payDate}
                max={todaySofia()}
                onChange={(e) => setPayDate(e.target.value)}
                aria-label={t('payments.paidAt')}
              />
              <EnumSelect
                value={payMethod}
                options={PaymentMethodEnum.options}
                prefix="enum.paymentMethod"
                onChange={(v) => v && setPayMethod(v)}
              />
              <button
                type="button"
                className="btn btn-primary btn-small"
                disabled={busy || !payDate}
                onClick={() =>
                  void bulk({ action: 'pay', ids, paidAt: payDate, method: payMethod })
                }
              >
                {t('payments.confirmPay')}
              </button>
            </span>
          ) : null}
        </div>
      ) : null}
      {list.loading && list.items.length === 0 ? (
        <Spinner />
      ) : list.items.length === 0 ? (
        <Empty text={t('payments.noInvoices')} />
      ) : (
        <div className="table-wrap">
          <table className="table invoices-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label={t('invoices.selectAll')}
                  />
                </th>
                <th>{t('payments.invoiceNo')}</th>
                <th>{t('invoices.reference')}</th>
                <th>{t('payments.building')}</th>
                <th>{t('payments.customer')}</th>
                <th>{t('payments.period')}</th>
                <th className="num">{t('payments.total')}</th>
                <th className="num">{t('invoices.paid')}</th>
                <th className="num">{t('invoices.open')}</th>
                <th>{t('payments.dueAt')}</th>
                <th>{t('payments.status')}</th>
                <th>{t('invoices.dunning')}</th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((inv) => (
                <tr
                  key={inv.id}
                  className={
                    inv.status === 'overdue'
                      ? 'row-error'
                      : selected.has(inv.id)
                        ? 'row-picked'
                        : ''
                  }
                >
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(inv.id)}
                      onChange={() => toggle(inv.id)}
                      aria-label={String(inv.number)}
                    />
                  </td>
                  <td>
                    <Link to={`/invoices/${inv.id}`}>{inv.number}</Link>
                  </td>
                  <td>
                    <code>{inv.paymentReference}</code>
                  </td>
                  <td>
                    <Link to={`/buildings/${inv.buildingId}`}>{inv.buildingAddressText}</Link>
                  </td>
                  <td>{inv.customerName ?? dash}</td>
                  <td>{inv.period}</td>
                  <td className="num">{money(inv.totalCents)}</td>
                  <td className="num">{inv.paidCents > 0 ? money(inv.paidCents) : dash}</td>
                  <td className="num">
                    {inv.openCents > 0 ? <strong>{moneyFull(inv.openCents)}</strong> : dash}
                  </td>
                  <td>{date(inv.dueAt)}</td>
                  <td>
                    <Badge kind={tone(inv.status)}>{t(`enum.invoiceStatus.${inv.status}`)}</Badge>
                  </td>
                  <td>
                    {inv.dunningStage > 0 ? (
                      <Badge kind="warn">
                        {t('invoices.stageN', { n: inv.dunningStage })}
                        {inv.dunningStageKey ? ` · ${inv.dunningStageKey}` : ''}
                      </Badge>
                    ) : null}
                    {inv.daysOverdue > 0 ? (
                      <Badge kind="danger">
                        {t('payments.overdueBy', { count: inv.daysOverdue })}
                      </Badge>
                    ) : null}
                    {inv.dunningStage === 0 && inv.daysOverdue === 0 ? dash : null}
                  </td>
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
