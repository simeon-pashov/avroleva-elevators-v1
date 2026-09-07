import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import type { ContractDto } from '@avroleva/contracts'
import { del, get, post } from '../../lib/api'
import { useI18n } from '../../i18n/I18nProvider'
import { useAuth } from '../../auth/AuthProvider'
import {
  Badge,
  ConfirmButton,
  ErrorBox,
  Field,
  PageHeader,
  Spinner,
  toast,
} from '../../components/ui'

export function ContractDetailPage() {
  const { id } = useParams()
  const { t, date, money, moneyFull } = useI18n()
  const { hasRole } = useAuth()
  const navigate = useNavigate()
  const [c, setC] = useState<ContractDto | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [terminating, setTerminating] = useState(false)
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [reason, setReason] = useState('')
  const canEdit = hasRole('owner', 'office')

  const load = useCallback(
    () => get<ContractDto>(`/contracts/${id}`).then(setC).catch(setError),
    [id],
  )
  useEffect(() => {
    void load()
  }, [load])

  if (error) return <ErrorBox error={error} />
  if (!c) return <Spinner />

  return (
    <div>
      <PageHeader
        back={
          <Link to="/contracts" className="back">
            {t('contracts.title')}
          </Link>
        }
        title={`${t('contracts.one')} · ${c.buildingAddressText ?? ''}`}
        actions={
          canEdit ? (
            <>
              {c.status !== 'terminated' ? (
                <Link className="btn" to={`/contracts/${c.id}/edit`}>
                  {t('common.edit')}
                </Link>
              ) : null}
              {c.status === 'active' ? (
                <button
                  type="button"
                  className="btn btn-danger-outline"
                  onClick={() => setTerminating((v) => !v)}
                >
                  {t('contracts.terminate')}
                </button>
              ) : (
                <ConfirmButton
                  label={t('common.archive')}
                  onConfirm={async () => {
                    await del(`/contracts/${c.id}`)
                    toast(t('common.archived'))
                    navigate('/contracts')
                  }}
                />
              )}
            </>
          ) : null
        }
      />
      {terminating ? (
        <form
          className="card narrow"
          onSubmit={async (e) => {
            e.preventDefault()
            try {
              await post(`/contracts/${c.id}/terminate`, { endDate, reason })
              toast(t('contracts.terminated'))
              setTerminating(false)
              await load()
            } catch (err) {
              setError(err)
            }
          }}
        >
          <h2>{t('contracts.terminate')}</h2>
          <p className="muted">{t('contracts.terminateHint')}</p>
          <Field label={t('contracts.endDate')} required>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
          <Field label={t('contracts.reason')}>
            <input value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div className="actions">
            <button type="submit" className="btn btn-danger">
              {t('contracts.terminateConfirm')}
            </button>
            <button type="button" className="btn" onClick={() => setTerminating(false)}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      ) : null}
      <div className="grid-2">
        <div className="card">
          <h2>{t('contracts.details')}</h2>
          <dl className="dl">
            <dt>{t('contracts.status')}</dt>
            <dd>
              <Badge kind={c.status === 'active' ? 'ok' : c.status === 'draft' ? 'warn' : 'muted'}>
                {t(`enum.contractStatus.${c.status}`)}
              </Badge>
            </dd>
            <dt>{t('contracts.customer')}</dt>
            <dd>
              <Link to={`/customers/${c.customerId}`}>{c.customerName}</Link>
            </dd>
            <dt>{t('contracts.building')}</dt>
            <dd>
              <Link to={`/buildings/${c.buildingId}`}>{c.buildingAddressText}</Link>
            </dd>
            <dt>{t('contracts.startDate')}</dt>
            <dd>{date(c.startDate)}</dd>
            <dt>{t('contracts.endDate')}</dt>
            <dd>{c.endDate ? date(c.endDate) : <span className="muted">—</span>}</dd>
            <dt>{t('contracts.paymentDay')}</dt>
            <dd>{c.paymentDay ?? <span className="muted">—</span>}</dd>
            {c.terminatedReason ? (
              <>
                <dt>{t('contracts.reason')}</dt>
                <dd>{c.terminatedReason}</dd>
              </>
            ) : null}
            <dt>{t('common.notes')}</dt>
            <dd className="pre">{c.notes ?? <span className="muted">—</span>}</dd>
          </dl>
        </div>
        <div className="card">
          <h2>{t('contracts.lines')}</h2>
          <table className="table">
            <thead>
              <tr>
                <th>{t('elevators.one')}</th>
                <th>{t('contracts.period')}</th>
                <th className="num">{t('contracts.monthlyPrice')}</th>
              </tr>
            </thead>
            <tbody>
              {c.lines.map((l) => (
                <tr key={l.id} className={l.toDate ? 'muted' : ''}>
                  <td>
                    <Link to={`/elevators/${l.elevatorId}`}>
                      {l.elevatorInternalNo ?? l.elevatorId}
                    </Link>
                  </td>
                  <td>
                    {date(l.fromDate)} – {l.toDate ? date(l.toDate) : '…'}
                  </td>
                  <td className="num">{money(l.monthlyPriceCents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th colSpan={2}>{t('contracts.monthlyTotal')}</th>
                <th className="num">{moneyFull(c.monthlyTotalCents)}</th>
              </tr>
            </tfoot>
          </table>
          <p className="muted small">{t('contracts.paymentsComingSoon')}</p>
        </div>
      </div>
    </div>
  )
}
