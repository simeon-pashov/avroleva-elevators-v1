import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useParams } from 'react-router'
import type {
  BillingConfigDto,
  CreatePaymentLinkResultDto,
  InvoiceDetailDto,
  NewPaymentMethod,
  PaymentDto,
  PaymentSource,
} from '@avroleva/contracts'
import { NewPaymentMethod as NewPaymentMethodEnum } from '@avroleva/contracts'
import { ApiError, BASE, get, post } from '../../lib/api'
import { todaySofia } from '../../lib/dates'
import { useI18n } from '../../i18n/I18nProvider'
import { Badge, ErrorBox, Field, PageHeader, Spinner, toast } from '../../components/ui'
import { EnumSelect } from '../../components/EnumSelect'
import { CopyButton, PayBlock } from '../../components/PayBlock'
import { useInvoiceTones } from './InvoicesListPage'

export function paymentSourceBadge(source: PaymentSource): 'ok' | 'info' | 'muted' {
  switch (source) {
    case 'provider':
      return 'ok'
    case 'bank_import':
      return 'info'
    default:
      return 'muted'
  }
}

const toCents = (eur: string) => Math.round(Number(eur || 0) * 100)

/** "Отбележи като платено": amount editable (partial or over-payment), reference, note. */
function PayForm({
  invoice,
  onDone,
  onCancel,
}: {
  invoice: InvoiceDetailDto
  onDone: () => void
  onCancel: () => void
}) {
  const { t } = useI18n()
  const [paidAt, setPaidAt] = useState(todaySofia)
  const [method, setMethod] = useState<NewPaymentMethod>('bank')
  const [amountEur, setAmountEur] = useState((invoice.openCents / 100).toFixed(2))
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const cents = toCents(amountEur)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setErrors({})
    try {
      await post(`/billing/invoices/${invoice.id}/pay`, {
        paidAt,
        method,
        amountCents: cents,
        reference: reference.trim() || null,
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
    <form className="card pay-form" onSubmit={submit}>
      <h2>{t('payments.markPaid')}</h2>
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
        <Field
          label={t('invoices.amountEur')}
          error={errors.amountCents}
          hint={
            cents > invoice.openCents
              ? t('invoices.overpayHint')
              : cents < invoice.openCents
                ? t('invoices.partialHint')
                : undefined
          }
        >
          <input
            type="number"
            min={0.01}
            step="0.01"
            value={amountEur}
            onChange={(e) => setAmountEur(e.target.value)}
            required
          />
        </Field>
      </div>
      <div className="row">
        <Field label={t('invoices.paymentReference')} error={errors.reference}>
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            maxLength={60}
            placeholder={invoice.paymentReference}
          />
        </Field>
        <Field label={t('payments.note')} error={errors.note}>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        </Field>
      </div>
      <div className="actions">
        <button type="submit" className="btn btn-primary btn-small" disabled={busy || cents <= 0}>
          {t('payments.confirmPay')}
        </button>
        <button type="button" className="btn btn-small" onClick={onCancel} disabled={busy}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  )
}

/** "Кредитно известие": gross amount (defaults to the open balance) and a reason. */
function CreditNoteForm({
  invoice,
  onDone,
  onCancel,
}: {
  invoice: InvoiceDetailDto
  onDone: () => void
  onCancel: () => void
}) {
  const { t } = useI18n()
  const [totalEur, setTotalEur] = useState((invoice.openCents / 100).toFixed(2))
  const [reason, setReason] = useState('')
  const [issuedAt, setIssuedAt] = useState(todaySofia)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setErrors({})
    try {
      await post(`/billing/invoices/${invoice.id}/credit-notes`, {
        totalCents: toCents(totalEur),
        reason: reason.trim(),
        issuedAt,
      })
      toast(t('invoices.creditNoteIssued'))
      onDone()
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) setErrors(err.fieldErrors)
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card pay-form" onSubmit={submit}>
      <h2>{t('invoices.creditNote')}</h2>
      <p className="muted small">{t('invoices.creditNoteHint')}</p>
      <ErrorBox error={error} />
      <div className="row">
        <Field label={t('invoices.creditTotalEur')} error={errors.totalCents} required>
          <input
            type="number"
            min={0.01}
            step="0.01"
            value={totalEur}
            onChange={(e) => setTotalEur(e.target.value)}
            required
          />
        </Field>
        <Field label={t('billing.doc.issuedAt')} error={errors.issuedAt}>
          <input
            type="date"
            value={issuedAt}
            max={todaySofia()}
            onChange={(e) => setIssuedAt(e.target.value)}
          />
        </Field>
      </div>
      <Field label={t('contracts.reason')} error={errors.reason} required>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          required
        />
      </Field>
      <div className="actions">
        <button
          type="submit"
          className="btn btn-primary btn-small"
          disabled={busy || reason.trim().length < 2}
        >
          {t('invoices.creditNoteIssue')}
        </button>
        <button type="button" className="btn btn-small" onClick={onCancel} disabled={busy}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  )
}

function InvoicePayments({ payments }: { payments: PaymentDto[] }) {
  const { t, date, money } = useI18n()
  const dash = <span className="muted">—</span>
  if (payments.length === 0) return <p className="muted small">{t('payments.emptyHistory')}</p>
  return (
    <div className="table-wrap">
      <table className="table compact">
        <thead>
          <tr>
            <th>{t('payments.paidAt')}</th>
            <th className="num">{t('payments.amount')}</th>
            <th>{t('payments.method')}</th>
            <th>{t('invoices.source')}</th>
            <th>{t('invoices.paymentReference')}</th>
            <th>{t('invoices.counterparty')}</th>
            <th>{t('payments.note')}</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((p) => (
            <tr key={p.id}>
              <td>{date(p.paidAt)}</td>
              <td className="num">{money(p.amountCents)}</td>
              <td>{t(`enum.paymentMethod.${p.method}`)}</td>
              <td>
                <Badge kind={paymentSourceBadge(p.source)}>
                  {t(`enum.paymentSource.${p.source}`)}
                </Badge>
                {p.provider === 'demo' ? <Badge kind="warn">{t('invoices.demo')}</Badge> : null}
                {p.providerRef ? <span className="muted small"> {p.providerRef}</span> : null}
              </td>
              <td>{p.reference ?? dash}</td>
              <td>{p.counterparty ?? dash}</td>
              <td>{p.note ?? dash}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** /invoices/:id — the document, its movements and the "how to pay" block. */
export function InvoiceDetailPage() {
  const { id } = useParams()
  const { t, date, dateTime, money, moneyFull } = useI18n()
  const [inv, setInv] = useState<InvoiceDetailDto | null>(null)
  const [config, setConfig] = useState<BillingConfigDto | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [actionError, setActionError] = useState<unknown>(null)
  const [mode, setMode] = useState<'none' | 'pay' | 'credit'>('none')
  const [busy, setBusy] = useState(false)
  const tone = useInvoiceTones(config)
  const dash = <span className="muted">—</span>

  const load = useCallback(async () => {
    try {
      setInv(await get<InvoiceDetailDto>(`/billing/invoices/${id}`))
    } catch (e) {
      setError(e)
    }
  }, [id])

  useEffect(() => {
    void load()
    get<BillingConfigDto>('/billing/config')
      .then(setConfig)
      .catch(() => {
        /* the fixed tone map still works */
      })
  }, [load])

  if (error) return <ErrorBox error={error} />
  if (!inv) return <Spinner />
  const open = inv.openCents > 0 && inv.status !== 'void'

  const createLink = async () => {
    setBusy(true)
    setActionError(null)
    try {
      const r = await post<CreatePaymentLinkResultDto>(`/billing/invoices/${inv.id}/payment-link`)
      toast(t('invoices.linkCreated'))
      await load()
      try {
        await navigator.clipboard.writeText(r.link.url)
      } catch {
        /* the list below shows it */
      }
    } catch (e) {
      setActionError(e)
    } finally {
      setBusy(false)
    }
  }

  const done = async () => {
    setMode('none')
    await load()
  }

  return (
    <div>
      <PageHeader
        back={
          <Link to="/invoices" className="back">
            {t('invoices.title')}
          </Link>
        }
        title={`${t('billing.doc.invoiceTitle')} № ${inv.number}`}
        subtitle={
          <>
            <Badge kind={tone(inv.status)}>{t(`enum.invoiceStatus.${inv.status}`)}</Badge>
            {inv.daysOverdue > 0 ? (
              <Badge kind="danger">{t('payments.overdueBy', { count: inv.daysOverdue })}</Badge>
            ) : null}
            {' · '}
            {t('billing.doc.reference')}: <code>{inv.paymentReference}</code>
            {' · '}
            {t('payments.period')}: {inv.period}
            {' · '}
            {t('billing.doc.dueAt')}: {date(inv.dueAt)}
          </>
        }
        actions={
          <>
            <a
              className="btn"
              href={`${BASE}/print/invoice/${inv.id}`}
              target="_blank"
              rel="noopener"
            >
              {t('reports.print')}
            </a>
            {open ? (
              <>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setMode(mode === 'credit' ? 'none' : 'credit')}
                >
                  {t('invoices.creditNote')}
                </button>
                {inv.paymentProvider.enabled ? (
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() => void createLink()}
                  >
                    {t('invoices.createLink')}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setMode(mode === 'pay' ? 'none' : 'pay')}
                >
                  {t('payments.markPaid')}
                </button>
              </>
            ) : null}
          </>
        }
      />
      <ErrorBox error={actionError} />
      {mode === 'pay' ? (
        <PayForm invoice={inv} onDone={() => void done()} onCancel={() => setMode('none')} />
      ) : null}
      {mode === 'credit' ? (
        <CreditNoteForm invoice={inv} onDone={() => void done()} onCancel={() => setMode('none')} />
      ) : null}
      <div className="grid-2 invoice-grid">
        <div>
          <div className="card">
            <h2>{t('invoices.details')}</h2>
            <dl className="dl">
              <dt>{t('billing.doc.recipient')}</dt>
              <dd>
                {inv.customerName ? (
                  <Link to={`/customers/${inv.customerId}`}>{inv.customerName}</Link>
                ) : (
                  dash
                )}
              </dd>
              <dt>{t('payments.building')}</dt>
              <dd>
                <Link to={`/buildings/${inv.buildingId}`}>{inv.buildingAddressText}</Link>
              </dd>
              {inv.contractId ? (
                <>
                  <dt>{t('contracts.one')}</dt>
                  <dd>
                    <Link to={`/contracts/${inv.contractId}`}>{t('invoices.openContract')}</Link>
                  </dd>
                </>
              ) : null}
              {inv.jobId ? (
                <>
                  <dt>{t('jobs.one')}</dt>
                  <dd>
                    <Link to={`/jobs/${inv.jobId}`}>{t('invoices.openJob')}</Link>
                  </dd>
                </>
              ) : null}
              <dt>{t('billing.doc.issuedAt')}</dt>
              <dd>{date(inv.issuedAt)}</dd>
              <dt>{t('billing.doc.period')}</dt>
              <dd>
                {date(inv.periodStart)} – {date(inv.periodEnd)}
              </dd>
              <dt>{t('billing.doc.dueAt')}</dt>
              <dd>{date(inv.dueAt)}</dd>
              {inv.paidAt ? (
                <>
                  <dt>{t('payments.paidOn')}</dt>
                  <dd>{date(inv.paidAt)}</dd>
                </>
              ) : null}
              {inv.dunningStage > 0 ? (
                <>
                  <dt>{t('invoices.dunning')}</dt>
                  <dd>
                    <Badge kind="warn">
                      {t('invoices.stageN', { n: inv.dunningStage })}
                      {inv.dunningStageKey ? ` · ${inv.dunningStageKey}` : ''}
                    </Badge>{' '}
                    {inv.dunningAt ? (
                      <span className="muted small">{date(inv.dunningAt)}</span>
                    ) : null}
                  </dd>
                </>
              ) : null}
            </dl>
            <h3 className="sub-head">{t('invoices.lines')}</h3>
            <div className="table-wrap">
              <table className="table compact">
                <thead>
                  <tr>
                    <th>{t('billing.doc.description')}</th>
                    <th>{t('elevators.one')}</th>
                    <th className="num">{t('billing.doc.amount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {inv.lines.map((l, i) => (
                    <tr key={`${l.elevatorId}-${i}`}>
                      <td>{l.description}</td>
                      <td>
                        <Link to={`/elevators/${l.elevatorId}`}>{t('invoices.openElevator')}</Link>
                      </td>
                      <td className="num">{money(l.amountCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <dl className="dl totals-dl">
              <dt>{t('billing.doc.net')}</dt>
              <dd className="num">{money(inv.amountCents)}</dd>
              <dt>{t('billing.doc.vat')}</dt>
              <dd className="num">{money(inv.vatCents)}</dd>
              <dt>{t('billing.doc.total')}</dt>
              <dd className="num">
                <strong>{moneyFull(inv.totalCents)}</strong>
              </dd>
              {inv.lateFeeCents > 0 ? (
                <>
                  <dt>{t('billing.doc.lateFee')}</dt>
                  <dd className="num">{money(inv.lateFeeCents)}</dd>
                </>
              ) : null}
              {inv.creditedCents > 0 ? (
                <>
                  <dt>{t('invoices.credited')}</dt>
                  <dd className="num">− {money(inv.creditedCents)}</dd>
                </>
              ) : null}
              <dt>{t('invoices.paid')}</dt>
              <dd className="num">− {money(inv.paidCents)}</dd>
              <dt>{t('billing.doc.open')}</dt>
              <dd className="num">
                <strong className={inv.openCents > 0 ? 'text-danger' : 'text-ok'}>
                  {moneyFull(inv.openCents)}
                </strong>
              </dd>
            </dl>
          </div>
          <div className="card">
            <h2>{t('payments.paymentsList')}</h2>
            <InvoicePayments payments={inv.payments} />
          </div>
          {inv.creditNotes.length > 0 ? (
            <div className="card">
              <h2>{t('invoices.creditNotes')}</h2>
              <div className="table-wrap">
                <table className="table compact">
                  <thead>
                    <tr>
                      <th>{t('payments.invoiceNo')}</th>
                      <th>{t('billing.doc.issuedAt')}</th>
                      <th className="num">{t('billing.doc.net')}</th>
                      <th className="num">{t('billing.doc.vat')}</th>
                      <th className="num">{t('payments.total')}</th>
                      <th>{t('contracts.reason')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inv.creditNotes.map((cn) => (
                      <tr key={cn.id}>
                        <td>{cn.number}</td>
                        <td>{date(cn.issuedAt)}</td>
                        <td className="num">{money(cn.amountCents)}</td>
                        <td className="num">{money(cn.vatCents)}</td>
                        <td className="num">{money(cn.totalCents)}</td>
                        <td>{cn.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
          {inv.adjustments.length > 0 ? (
            <div className="card">
              <h2>{t('invoices.adjustments')}</h2>
              <div className="table-wrap">
                <table className="table compact">
                  <thead>
                    <tr>
                      <th>{t('reports.created')}</th>
                      <th>{t('invoices.kind')}</th>
                      <th>{t('billingSettings.stageKey')}</th>
                      <th className="num">{t('payments.amount')}</th>
                      <th>{t('contracts.reason')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inv.adjustments.map((a) => (
                      <tr key={a.id}>
                        <td>{dateTime(a.createdAt)}</td>
                        <td>{t('billing.doc.lateFee')}</td>
                        <td>{a.stageKey ?? dash}</td>
                        <td className="num">{money(a.amountCents)}</td>
                        <td>{a.reason ?? dash}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
          {inv.paymentLinks.length > 0 ? (
            <div className="card">
              <h2>{t('invoices.paymentLinks')}</h2>
              <ul className="list compact">
                {inv.paymentLinks.map((l) => (
                  <li key={l.id} className="copy-row">
                    <Badge
                      kind={l.status === 'paid' ? 'ok' : l.status === 'open' ? 'info' : 'muted'}
                    >
                      {t(`invoices.linkStatus.${l.status}`)}
                    </Badge>
                    <span className="muted small">
                      {t(`enum.paymentProvider.${l.provider}`)} · {money(l.amountCents)} ·{' '}
                      {dateTime(l.createdAt)}
                    </span>
                    <a href={l.url} target="_blank" rel="noopener" className="link-url">
                      {l.url}
                    </a>
                    <CopyButton text={l.url} />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
        <div>
          <PayBlock
            bank={inv.bank}
            epc={inv.epc}
            reference={inv.paymentReference}
            amountCents={inv.openCents}
          />
          {inv.paymentProvider.name !== 'none' ? (
            <div className="card">
              <h2>{t('billingSettings.providerTitle')}</h2>
              <p className="small">
                {t(`enum.paymentProvider.${inv.paymentProvider.name}`)}{' '}
                <Badge kind={inv.paymentProvider.enabled ? 'ok' : 'muted'}>
                  {inv.paymentProvider.enabled
                    ? t('billingSettings.ruleEnabled')
                    : t('billingSettings.ruleDisabled')}
                </Badge>
              </p>
              {inv.paymentProvider.note ? (
                <p className="muted small">
                  {inv.paymentProvider.note.startsWith('billing.provider.')
                    ? t(inv.paymentProvider.note)
                    : inv.paymentProvider.note}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
