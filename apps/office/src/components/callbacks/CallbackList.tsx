import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router'
import type { CallbackDetailDto, CallbackDto, ChargeReason, UserDto } from '@avroleva/contracts'
import { ChargeReason as ChargeReasonEnum } from '@avroleva/contracts'
import { ApiError, get, post } from '../../lib/api'
import { useI18n } from '../../i18n/I18nProvider'
import { useAuth } from '../../auth/AuthProvider'
import { Badge, Empty, ErrorBox, Field, Spinner, toast } from '../ui'
import { EnumSelect } from '../EnumSelect'
import { CallbackTimer, callbackStatusBadge } from './CallbackTimer'

/** Active users for the dispatch picker (owner/office only; technicians never see the list). */
export function useTechnicians(enabled: boolean): UserDto[] {
  const [users, setUsers] = useState<UserDto[]>([])
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    get<{ items: UserDto[] }>('/users')
      .then((r) => !cancelled && setUsers(r.items.filter((u) => u.isActive)))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [enabled])
  return users
}

function CloseForm({
  c,
  onDone,
  onCancel,
}: {
  c: CallbackDto
  onDone: () => void
  onCancel: () => void
}) {
  const { t } = useI18n()
  const [cause, setCause] = useState('')
  const [actionTaken, setActionTaken] = useState('')
  const [chargeable, setChargeable] = useState(false)
  const [chargeReason, setChargeReason] = useState<ChargeReason | ''>('')
  const [createVisit, setCreateVisit] = useState(true)
  const [notes, setNotes] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await post(`/callbacks/${c.id}/close`, {
        cause,
        actionTaken,
        chargeable,
        chargeReason: chargeable ? chargeReason || 'other' : null,
        createVisit,
        notes: notes.trim() || null,
      })
      toast(t('callbacks.closed'))
      onDone()
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) setErrors(err.fieldErrors)
      setError(err)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="inset cb-close" onSubmit={submit}>
      <h3 className="sub-head">{t('callbacks.closeTitle')}</h3>
      <ErrorBox error={error} />
      <Field label={t('callbacks.cause')} error={errors.cause} required>
        <input value={cause} onChange={(e) => setCause(e.target.value)} required maxLength={2000} />
      </Field>
      <Field label={t('callbacks.actionTaken')} error={errors.actionTaken} required>
        <input
          value={actionTaken}
          onChange={(e) => setActionTaken(e.target.value)}
          required
          maxLength={2000}
        />
      </Field>
      <div className="row checks">
        <label className="check">
          <input
            type="checkbox"
            checked={chargeable}
            onChange={(e) => setChargeable(e.target.checked)}
          />
          <span>{t('callbacks.chargeable')}</span>
        </label>
        {chargeable ? (
          <Field label={t('callbacks.chargeReason')} error={errors.chargeReason}>
            <EnumSelect
              value={chargeReason}
              options={ChargeReasonEnum.options}
              prefix="enum.chargeReason"
              allowEmpty
              emptyLabel={t('common.choose')}
              onChange={setChargeReason}
            />
          </Field>
        ) : null}
        <label className="check">
          <input
            type="checkbox"
            checked={createVisit}
            onChange={(e) => setCreateVisit(e.target.checked)}
          />
          <span>{t('callbacks.createVisit')}</span>
        </label>
      </div>
      <Field label={t('common.notes')} error={errors.notes}>
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {t('callbacks.close')}
        </button>
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  )
}

function Timeline({ id }: { id: string }) {
  const { t, dateTime } = useI18n()
  const [d, setD] = useState<CallbackDetailDto | null>(null)
  const [error, setError] = useState<unknown>(null)
  useEffect(() => {
    let cancelled = false
    get<CallbackDetailDto>(`/callbacks/${id}`)
      .then((x) => !cancelled && setD(x))
      .catch((e) => !cancelled && setError(e))
    return () => {
      cancelled = true
    }
  }, [id])
  if (error) return <ErrorBox error={error} />
  if (!d) return <Spinner />
  return (
    <div className="inset">
      <h3 className="sub-head">{t('callbacks.timeline')}</h3>
      <ul className="list timeline">
        {d.events.map((e) => (
          <li key={e.id}>
            <strong>{dateTime(e.at)}</strong> · {t(`enum.callbackEvent.${e.type}`)}
            {e.byUserName ? <span className="muted"> · {e.byUserName}</span> : null}
            <span className="muted small"> ({t(`enum.eventSource.${e.source}`)})</span>
            {typeof e.data.notes === 'string' ? (
              <div className="small pre">{e.data.notes}</div>
            ) : null}
          </li>
        ))}
      </ul>
      {d.cause ? (
        <dl className="dl compact">
          <dt>{t('callbacks.cause')}</dt>
          <dd>{d.cause}</dd>
          <dt>{t('callbacks.actionTaken')}</dt>
          <dd>{d.actionTaken}</dd>
          {d.chargeable ? (
            <>
              <dt>{t('callbacks.chargeable')}</dt>
              <dd>{d.chargeReason ? t(`enum.chargeReason.${d.chargeReason}`) : '—'}</dd>
            </>
          ) : null}
        </dl>
      ) : null}
      {d.notes ? <div className="small pre">{d.notes}</div> : null}
    </div>
  )
}

/**
 * Rows with the live timer and one button per possible transition. Used by the callbacks page,
 * the elevator tabs and the dashboard widget (compact).
 */
export function CallbackList({
  items,
  onChanged,
  showElevator = true,
  emptyText,
}: {
  items: CallbackDto[]
  onChanged: () => void
  showElevator?: boolean
  emptyText?: string
}) {
  const { t, dateTime } = useI18n()
  const { hasRole, me } = useAuth()
  const isOffice = hasRole('owner', 'office')
  const users = useTechnicians(isOffice)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [closing, setClosing] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [dispatching, setDispatching] = useState<string | null>(null)
  const [dispatchUser, setDispatchUser] = useState('')

  const act = async (c: CallbackDto, path: string, body: unknown = {}) => {
    setBusyId(c.id)
    try {
      await post(`/callbacks/${c.id}/${path}`, body)
      toast(t('callbacks.updated'))
      onChanged()
    } catch (e) {
      toast(e instanceof ApiError ? e.problem.title : t('error.internal'), 'error')
    } finally {
      setBusyId(null)
      setDispatching(null)
    }
  }

  if (items.length === 0) return <Empty text={emptyText ?? t('callbacks.empty')} />

  return (
    <ul className="list cb-list">
      {items.map((c) => {
        const busy = busyId === c.id
        const mine = c.assignedUserId === me?.user.id
        const canAct = isOffice || mine || (!c.assignedUserId && hasRole('technician'))
        const s = c.status
        return (
          <li key={c.id} className={`cb-row cb-${c.slaState}`}>
            <div className="cb-main">
              <div className="cb-head">
                <CallbackTimer c={c} showLimit={s !== 'closed'} />
                <Badge kind={callbackStatusBadge(s)}>{t(`enum.callbackStatus.${s}`)}</Badge>
                <Badge kind={c.classification === 'trapped_persons' ? 'danger' : 'muted'}>
                  {t(`enum.callbackClassification.${c.classification}`)}
                  {c.trappedCount ? ` · ${c.trappedCount}` : ''}
                </Badge>
                <span className="muted small">{t(`enum.callbackChannel.${c.channel}`)}</span>
                {c.chargeable ? <Badge kind="warn">{t('callbacks.chargeable')}</Badge> : null}
              </div>
              {showElevator ? (
                <div>
                  <Link to={`/elevators/${c.elevatorId}`}>
                    <strong>{c.elevatorInternalNo}</strong>
                  </Link>
                  {' · '}
                  <Link to={`/buildings/${c.buildingId}`}>{c.buildingAddressText}</Link>
                </div>
              ) : null}
              <div className="small">
                {dateTime(c.receivedAt)}
                {c.callerName || c.callerPhone ? (
                  <>
                    {' · '}
                    {c.callerName}
                    {c.callerPhone ? (
                      <>
                        {' '}
                        <a href={`tel:${c.callerPhone}`}>{c.callerPhone}</a>
                      </>
                    ) : null}
                  </>
                ) : null}
                {' · '}
                <span className="muted">{t('callbacks.assigned')}: </span>
                {c.assignedUserName ?? <span className="muted">{t('callbacks.unassigned')}</span>}
                {c.responseMinutes != null ? (
                  <>
                    {' · '}
                    <span className="muted">{t('callbacks.response')}: </span>
                    {t('callbacks.responseMinutes', { count: c.responseMinutes })}
                  </>
                ) : null}
              </div>
              <div className="pre">{c.description}</div>
            </div>
            <div className="actions cb-actions">
              {canAct && (s === 'open' || s === 'dispatched') && isOffice ? (
                dispatching === c.id ? (
                  <span className="confirm-group">
                    <select value={dispatchUser} onChange={(e) => setDispatchUser(e.target.value)}>
                      <option value="">{t('common.choose')}</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name} ({t(`enum.userRole.${u.role}`)})
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn btn-small btn-primary"
                      disabled={!dispatchUser || busy}
                      onClick={() => act(c, 'dispatch', { userId: dispatchUser })}
                    >
                      {t('callbacks.dispatch')}
                    </button>
                    <button
                      type="button"
                      className="btn btn-small"
                      onClick={() => setDispatching(null)}
                    >
                      {t('common.cancel')}
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="btn btn-small btn-primary"
                    disabled={busy}
                    onClick={() => {
                      setDispatchUser(c.assignedUserId ?? '')
                      setDispatching(c.id)
                    }}
                  >
                    {c.assignedUserId ? t('callbacks.dispatchTo') : t('callbacks.dispatch')}
                  </button>
                )
              ) : null}
              {canAct && (s === 'open' || s === 'dispatched') ? (
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={busy}
                  onClick={() => act(c, 'on-site')}
                >
                  {t('callbacks.onSite')}
                </button>
              ) : null}
              {canAct && s === 'on_site' && c.classification === 'trapped_persons' ? (
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={busy}
                  onClick={() => act(c, 'released')}
                >
                  {t('callbacks.released')}
                </button>
              ) : null}
              {canAct && (s === 'on_site' || s === 'released') ? (
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={busy}
                  onClick={() => act(c, 'restored')}
                >
                  {t('callbacks.restored')}
                </button>
              ) : null}
              {canAct && s !== 'closed' ? (
                <button
                  type="button"
                  className="btn btn-small btn-danger-outline"
                  disabled={busy}
                  onClick={() => setClosing(closing === c.id ? null : c.id)}
                >
                  {t('callbacks.close')}
                </button>
              ) : null}
              <button
                type="button"
                className="btn btn-small"
                onClick={() => setExpanded(expanded === c.id ? null : c.id)}
              >
                {t('callbacks.timeline')}
              </button>
              {c.closeoutVisitId ? (
                <Link className="btn btn-small" to={`/elevators/${c.elevatorId}`}>
                  {t('callbacks.visit')}
                </Link>
              ) : null}
            </div>
            {closing === c.id ? (
              <CloseForm
                c={c}
                onDone={() => {
                  setClosing(null)
                  onChanged()
                }}
                onCancel={() => setClosing(null)}
              />
            ) : null}
            {expanded === c.id ? <Timeline id={c.id} /> : null}
          </li>
        )
      })}
    </ul>
  )
}
