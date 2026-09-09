import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import type { BuildingStatementDto, ReportRunDto, StatementLineDto } from '@avroleva/contracts'
import { ApiError, get, post, qs, serverPath } from '../../lib/api'
import { useI18n } from '../../i18n/I18nProvider'
import { Badge, ErrorBox, PageHeader, Spinner, toast } from '../../components/ui'
import { PayBlock } from '../../components/PayBlock'
import { defaultStatementRange } from './BuildingStatementCard'

function lineKindBadge(k: StatementLineDto['kind']): 'ok' | 'warn' | 'info' | 'muted' {
  switch (k) {
    case 'payment':
      return 'ok'
    case 'credit_note':
      return 'info'
    case 'late_fee':
      return 'warn'
    default:
      return 'muted'
  }
}

/** /buildings/:id/statement?from&to — the building's ledger with the open balance to pay. */
export function BuildingStatementPage() {
  const { id } = useParams()
  const [params, setParams] = useSearchParams()
  const { t, date, money, moneyFull } = useI18n()
  const defaults = defaultStatementRange()
  const from = params.get('from') || defaults.from
  const to = params.get('to') || defaults.to
  const [range, setRange] = useState({ from, to })
  const [st, setSt] = useState<BuildingStatementDto | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    setSt(null)
    get<BuildingStatementDto>(`/buildings/${id}/statement${qs({ from, to })}`)
      .then((s) => !cancelled && setSt(s))
      .catch((e) => !cancelled && setError(e))
    return () => {
      cancelled = true
    }
  }, [id, from, to])

  const apply = () =>
    setParams((p) => {
      p.set('from', range.from)
      p.set('to', range.to)
      return p
    })

  const send = async () => {
    setBusy(true)
    try {
      const run = await post<ReportRunDto>(`/reports/statement/${id}/send`, { from, to })
      toast(run.sentTo ? t('reports.sent', { to: run.sentTo }) : t('reports.statementSent'))
    } catch (e) {
      if (e instanceof ApiError && e.problem.code === 'reports.noEmail')
        toast(e.problem.title, 'error')
      else setError(e)
    } finally {
      setBusy(false)
    }
  }

  if (error) return <ErrorBox error={error} />
  if (!st) return <Spinner />
  const balanceClass = (c: number) => (c > 0 ? 'text-danger' : c < 0 ? 'text-ok' : '')

  return (
    <div>
      <PageHeader
        back={
          <Link to={`/buildings/${st.buildingId}`} className="back">
            {st.buildingAddressText}
          </Link>
        }
        title={`${t('statement.title')} · ${st.buildingAddressText}`}
        subtitle={
          <>
            {st.customerName ? <>{st.customerName} · </> : null}
            {date(st.from)} – {date(st.to)}
            {st.contactName ? (
              <>
                {' · '}
                {st.contactName}
                {st.contactEmail ? ` (${st.contactEmail})` : ''}
              </>
            ) : null}
          </>
        }
        actions={
          <>
            <span className="inline-form-row">
              <input
                type="date"
                value={range.from}
                max={range.to}
                aria-label={t('statement.from')}
                onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
              />
              <input
                type="date"
                value={range.to}
                min={range.from}
                aria-label={t('statement.to')}
                onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
              />
              <button type="button" className="btn btn-small" onClick={apply}>
                {t('statement.show')}
              </button>
            </span>
            <a className="btn" href={serverPath(st.printUrl)} target="_blank" rel="noopener">
              {t('reports.print')}
            </a>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void send()}
            >
              {t('statement.sendEmail')}
            </button>
          </>
        }
      />
      <div className="grid-2 statement-grid">
        <div>
          <div className="card">
            <div className="totals">
              <div className="total">
                <span className="muted small">{t('statement.opening')}</span>
                <strong className={balanceClass(st.openingBalanceCents)}>
                  {moneyFull(st.openingBalanceCents)}
                </strong>
              </div>
              <div className="total">
                <span className="muted small">{t('statement.closing')}</span>
                <strong className={balanceClass(st.closingBalanceCents)}>
                  {moneyFull(st.closingBalanceCents)}
                </strong>
              </div>
            </div>
            {st.lines.length === 0 ? (
              <p className="muted">{t('statement.empty')}</p>
            ) : (
              <div className="table-wrap">
                <table className="table compact">
                  <thead>
                    <tr>
                      <th>{t('payments.paidAt')}</th>
                      <th>{t('statement.col.kind')}</th>
                      <th>{t('invoices.reference')}</th>
                      <th>{t('billing.doc.description')}</th>
                      <th className="num">{t('statement.col.debit')}</th>
                      <th className="num">{t('statement.col.credit')}</th>
                      <th className="num">{t('statement.col.balance')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="muted">
                      <td>{date(st.from)}</td>
                      <td colSpan={5}>{t('statement.opening')}</td>
                      <td className="num">{money(st.openingBalanceCents)}</td>
                    </tr>
                    {st.lines.map((l, i) => (
                      <tr key={i}>
                        <td className="nowrap">{date(l.date)}</td>
                        <td>
                          <Badge kind={lineKindBadge(l.kind)}>
                            {t(`statement.kind.${l.kind}`)}
                          </Badge>
                        </td>
                        <td>
                          {l.invoiceId ? (
                            <Link to={`/invoices/${l.invoiceId}`}>{l.ref}</Link>
                          ) : (
                            l.ref
                          )}
                        </td>
                        <td>{l.description}</td>
                        <td className="num">{l.debitCents ? money(l.debitCents) : ''}</td>
                        <td className="num">{l.creditCents ? money(l.creditCents) : ''}</td>
                        <td className={`num ${balanceClass(l.balanceCents)}`}>
                          {money(l.balanceCents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th colSpan={6}>{t('statement.closing')}</th>
                      <th className={`num ${balanceClass(st.closingBalanceCents)}`}>
                        {moneyFull(st.closingBalanceCents)}
                      </th>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
          <div className="card">
            <h2>{t('statement.openInvoices')}</h2>
            {st.openInvoices.length === 0 ? (
              <p className="muted">{t('payments.emptyPending')}</p>
            ) : (
              <div className="table-wrap">
                <table className="table compact">
                  <thead>
                    <tr>
                      <th>{t('payments.invoiceNo')}</th>
                      <th>{t('billing.doc.reference')}</th>
                      <th className="num">{t('invoices.open')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {st.openInvoices.map((i) => (
                      <tr key={i.id}>
                        <td>
                          <Link to={`/invoices/${i.id}`}>{i.number}</Link>
                        </td>
                        <td>
                          <code>{i.paymentReference}</code>
                        </td>
                        <td className="num">{money(i.openCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
        <PayBlock
          bank={st.bank}
          epc={st.epc}
          amountCents={st.closingBalanceCents > 0 ? st.closingBalanceCents : null}
        />
      </div>
    </div>
  )
}
