import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import type {
  ApprovalEvidenceKind,
  JobDetailDto,
  JobLineDto,
  JobLineKind,
  SendQuoteResultDto,
  UserDto,
} from '@avroleva/contracts'
import {
  ApprovalEvidenceKind as EvidenceEnum,
  JobLineKind as JobLineKindEnum,
} from '@avroleva/contracts'
import { ApiError, BASE, del, get, patch, post } from '../../lib/api'
import { nowLocalInput, localInputToIso, todaySofia } from '../../lib/dates'
import { useI18n } from '../../i18n/I18nProvider'
import { useAuth } from '../../auth/AuthProvider'
import { Badge, ErrorBox, Field, PageHeader, Spinner, toast } from '../../components/ui'
import { EnumSelect } from '../../components/EnumSelect'
import { stageBadge, stageLabel, useJobsConfig } from '../../components/jobs/jobsConfig'
import { invoiceStatusBadge } from '../../components/ElevatorTabs'

type Panel =
  | 'none'
  | 'send'
  | 'approve'
  | 'schedule'
  | 'complete'
  | 'invoice'
  | 'reject'
  | 'cancel'
  | 'transition'

const EDITABLE = new Set(['draft', 'quoted', 'awaiting_approval'])

function errText(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.problem.title : e instanceof Error ? e.message : fallback
}

/** One quote line row: inline edit while the quote is open. */
function LineRow({
  line,
  editable,
  onSave,
  onRemove,
}: {
  line: JobLineDto
  editable: boolean
  onSave: (patch: {
    kind?: JobLineKind
    description?: string
    qty?: number
    unitCents?: number
    partRef?: string | null
  }) => Promise<void>
  onRemove: () => Promise<void>
}) {
  const { t, money, number } = useI18n()
  const [editing, setEditing] = useState(false)
  const [kind, setKind] = useState<JobLineKind>(line.kind)
  const [description, setDescription] = useState(line.description)
  const [qty, setQty] = useState(String(line.qty))
  const [unit, setUnit] = useState((line.unitCents / 100).toFixed(2))
  const [partRef, setPartRef] = useState(line.partRef ?? '')
  const [busy, setBusy] = useState(false)
  if (!editing)
    return (
      <tr>
        <td>{t(`enum.jobLineKind.${line.kind}`)}</td>
        <td>
          {line.description}
          {line.partRef ? <div className="small muted">{line.partRef}</div> : null}
        </td>
        <td className="num">{number(line.qty, { maximumFractionDigits: 3 })}</td>
        <td className="num">{money(line.unitCents)}</td>
        <td className="num">{money(line.totalCents)}</td>
        <td className="nowrap">
          {editable ? (
            <>
              <button type="button" className="btn btn-small" onClick={() => setEditing(true)}>
                {t('common.edit')}
              </button>{' '}
              <button
                type="button"
                className="btn btn-small btn-danger-outline"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  try {
                    await onRemove()
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                ×
              </button>
            </>
          ) : null}
        </td>
      </tr>
    )
  return (
    <tr className="row-form">
      <td>
        <EnumSelect
          value={kind}
          options={JobLineKindEnum.options}
          prefix="enum.jobLineKind"
          onChange={(v) => v && setKind(v)}
        />
      </td>
      <td>
        <input value={description} onChange={(e) => setDescription(e.target.value)} />
        <input
          value={partRef}
          placeholder={t('jobs.line.partRef')}
          onChange={(e) => setPartRef(e.target.value)}
        />
      </td>
      <td className="num">
        <input
          className="num-input"
          inputMode="decimal"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
        />
      </td>
      <td className="num">
        <input
          className="num-input"
          inputMode="decimal"
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
        />
      </td>
      <td className="num">
        {money(
          Math.round(
            (Number(qty.replace(',', '.')) || 0) *
              (Math.round(Number(unit.replace(',', '.')) * 100) || 0),
          ),
        )}
      </td>
      <td className="nowrap">
        <button
          type="button"
          className="btn btn-small btn-primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              await onSave({
                kind,
                description: description.trim(),
                qty: Number(qty.replace(',', '.')) || 0,
                unitCents: Math.round(Number(unit.replace(',', '.')) * 100) || 0,
                partRef: partRef.trim() || null,
              })
              setEditing(false)
            } finally {
              setBusy(false)
            }
          }}
        >
          {t('common.save')}
        </button>{' '}
        <button type="button" className="btn btn-small" onClick={() => setEditing(false)}>
          {t('common.cancel')}
        </button>
      </td>
    </tr>
  )
}

/**
 * One repair job: stage + actions that follow the data-driven machine, the quote lines with
 * totals and ДДС, approval evidence, scheduling with the technician pair, completion, invoicing
 * (full or deposit), the event timeline and the links to the visit / invoices / origin.
 */
export function JobDetailPage() {
  const { id } = useParams()
  const { t, locale, date, dateTime, money, moneyFull, number } = useI18n()
  const { hasRole } = useAuth()
  const navigate = useNavigate()
  const canEdit = hasRole('owner', 'office')
  const [version, setVersion] = useState(0)
  const cfg = useJobsConfig()
  const [job, setJob] = useState<JobDetailDto | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [panel, setPanel] = useState<Panel>('none')
  const [busy, setBusy] = useState(false)
  const [users, setUsers] = useState<UserDto[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [viber, setViber] = useState<SendQuoteResultDto['viber']>(null)
  // add line
  const [newLine, setNewLine] = useState({
    kind: 'part' as JobLineKind,
    description: '',
    qty: '1',
    unit: '',
    partRef: '',
  })
  // forms
  const [sendChannel, setSendChannel] = useState<'none' | 'email' | 'viber'>('email')
  const [sendTo, setSendTo] = useState('')
  const [sendMessage, setSendMessage] = useState('')
  const [evKind, setEvKind] = useState<ApprovalEvidenceKind>('verbal')
  const [evBy, setEvBy] = useState('')
  const [evNote, setEvNote] = useState('')
  const [schedAt, setSchedAt] = useState(nowLocalInput())
  const [schedUsers, setSchedUsers] = useState<string[]>([])
  const [doneAt, setDoneAt] = useState(nowLocalInput())
  const [doneNotes, setDoneNotes] = useState('')
  const [doneParts, setDoneParts] = useState('')
  const [warranty, setWarranty] = useState('')
  const [createVisit, setCreateVisit] = useState(true)
  const [invKind, setInvKind] = useState<'full' | 'partial'>('full')
  const [invAmount, setInvAmount] = useState('')
  const [invIssuedAt, setInvIssuedAt] = useState(todaySofia())
  const [reason, setReason] = useState('')
  const [target, setTarget] = useState('')

  const load = useCallback(() => {
    if (!id) return Promise.resolve()
    return get<JobDetailDto>(`/jobs/${id}`)
      .then((j) => {
        setJob(j)
        setError(null)
        if (j.assignedUserIds.length) setSchedUsers(j.assignedUserIds)
      })
      .catch(setError)
  }, [id])
  useEffect(() => {
    void load()
  }, [load, version])
  useEffect(() => {
    if (!canEdit) return
    get<{ items: UserDto[] }>('/users')
      .then((r) => setUsers(r.items.filter((u) => u.isActive && u.role === 'technician')))
      .catch(() => undefined)
  }, [canEdit])
  useEffect(() => {
    if (cfg && warranty === '') setWarranty(String(cfg.defaultWarrantyMonths))
  }, [cfg, warranty])

  const bump = () => setVersion((v) => v + 1)
  const act = async (fn: () => Promise<unknown>, okMsg?: string) => {
    setBusy(true)
    try {
      await fn()
      if (okMsg) toast(okMsg)
      setPanel('none')
      bump()
    } catch (e) {
      toast(errText(e, t('error.internal')), 'error')
    } finally {
      setBusy(false)
    }
  }

  if (error) return <ErrorBox error={error} />
  if (!job || !cfg) return <Spinner />
  const stage = cfg.stages.find((s) => s.code === job.status)
  const next = stage?.allowedNext ?? []
  const editable = canEdit && EDITABLE.has(job.status)
  const remaining = Math.max(0, job.netCents - job.invoicedCents)
  const canInvoicePartial =
    canEdit &&
    ['approved', 'scheduled', 'in_progress', 'done'].includes(job.status) &&
    remaining > 0
  const genericTargets = next.filter(
    (c) =>
      ![
        'quoted',
        'awaiting_approval',
        'approved',
        'scheduled',
        'in_progress',
        'done',
        'invoiced',
        'rejected',
        'cancelled',
        'draft',
      ].includes(c),
  )
  const toCents = (s: string) => Math.round(Number(s.replace(',', '.')) * 100) || 0
  const submit = (fn: () => Promise<unknown>, okMsg?: string) => (e: FormEvent) => {
    e.preventDefault()
    void act(fn, okMsg)
  }

  return (
    <div>
      <PageHeader
        back={
          <Link to="/jobs" className="back">
            {t('jobs.title')}
          </Link>
        }
        title={job.title}
        subtitle={
          <span className="due-counts">
            <Badge kind={stageBadge(job.status)}>
              {stageLabel(cfg.stages, job.status, locale, t)}
            </Badge>
            <Badge kind="muted">{t(`enum.jobKind.${job.kind}`)}</Badge>
            {job.quoteVersion > 1 ? (
              <Badge kind="info">{t('jobs.quote.version', { n: job.quoteVersion })}</Badge>
            ) : null}
            {job.status === 'done' && remaining > 0 ? (
              <Badge kind="danger">{t('jobs.notInvoiced')}</Badge>
            ) : null}
          </span>
        }
        actions={
          <>
            {canEdit ? (
              <a
                className="btn"
                href={`${BASE}/print/quote/${job.id}`}
                target="_blank"
                rel="noopener"
              >
                {t('jobs.printQuote')}
              </a>
            ) : null}
            {canEdit &&
            (job.status === 'draft' ||
              job.status === 'quoted' ||
              job.status === 'awaiting_approval') ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setPanel(panel === 'send' ? 'none' : 'send')}
                disabled={job.lines.length === 0}
              >
                {t('jobs.sendQuote')}
              </button>
            ) : null}
            {canEdit && next.includes('approved') && !job.approvedAt ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setPanel(panel === 'approve' ? 'none' : 'approve')}
              >
                {t('jobs.approve')}
              </button>
            ) : null}
            {canEdit && (next.includes('scheduled') || job.status === 'scheduled') ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setPanel(panel === 'schedule' ? 'none' : 'schedule')}
              >
                {job.status === 'scheduled' ? t('jobs.reschedule') : t('jobs.schedule')}
              </button>
            ) : null}
            {next.includes('in_progress') ? (
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => act(() => post(`/jobs/${job.id}/start`, {}), t('jobs.started'))}
              >
                {t('jobs.start')}
              </button>
            ) : null}
            {next.includes('done') ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setPanel(panel === 'complete' ? 'none' : 'complete')}
              >
                {t('jobs.complete')}
              </button>
            ) : null}
            {canEdit && (next.includes('invoiced') || canInvoicePartial) ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setInvKind(next.includes('invoiced') ? 'full' : 'partial')
                  setPanel(panel === 'invoice' ? 'none' : 'invoice')
                }}
              >
                {t('jobs.createInvoice')}
              </button>
            ) : null}
            {canEdit && next.includes('draft') ? (
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => act(() => post(`/jobs/${job.id}/revise`, {}), t('jobs.revised'))}
              >
                {t('jobs.revise')}
              </button>
            ) : null}
            {canEdit && next.includes('rejected') ? (
              <button
                type="button"
                className="btn btn-danger-outline"
                onClick={() => setPanel(panel === 'reject' ? 'none' : 'reject')}
              >
                {t('jobs.reject')}
              </button>
            ) : null}
            {canEdit && next.includes('cancelled') ? (
              <button
                type="button"
                className="btn btn-danger-outline"
                onClick={() => setPanel(panel === 'cancel' ? 'none' : 'cancel')}
              >
                {t('jobs.cancel')}
              </button>
            ) : null}
            {canEdit && genericTargets.length ? (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setTarget(genericTargets[0]!)
                  setPanel(panel === 'transition' ? 'none' : 'transition')
                }}
              >
                {t('jobs.moveTo')}
              </button>
            ) : null}
          </>
        }
      />

      {panel === 'send' ? (
        <form
          className="card narrow"
          onSubmit={submit(async () => {
            const r = await post<SendQuoteResultDto>(`/jobs/${job.id}/send-quote`, {
              channel: sendChannel,
              email: sendChannel === 'email' ? sendTo : undefined,
              phone: sendChannel === 'viber' ? sendTo : undefined,
              message: sendMessage || null,
            })
            setViber(r.viber)
            setShowHistory(false)
          }, t('jobs.quoteSent'))}
        >
          <h2>{t('jobs.sendQuote')}</h2>
          <p className="muted small">{t('jobs.sendHint')}</p>
          <Field label={t('jobs.channel')}>
            <select
              value={sendChannel}
              onChange={(e) => setSendChannel(e.target.value as 'none' | 'email' | 'viber')}
            >
              <option value="email">{t('enum.notificationChannel.email')}</option>
              <option value="viber">{t('enum.notificationChannel.viber_link')}</option>
              <option value="none">{t('jobs.channelNone')}</option>
            </select>
          </Field>
          {sendChannel !== 'none' ? (
            <Field
              label={sendChannel === 'email' ? t('contacts.email') : t('contacts.phone')}
              required
            >
              <input value={sendTo} onChange={(e) => setSendTo(e.target.value)} required />
            </Field>
          ) : null}
          <Field label={t('jobs.message')}>
            <textarea
              rows={3}
              value={sendMessage}
              onChange={(e) => setSendMessage(e.target.value)}
            />
          </Field>
          <div className="actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {t('jobs.send')}
            </button>
            <button type="button" className="btn" onClick={() => setPanel('none')}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      ) : null}
      {viber ? (
        <div className="card narrow viber-box">
          <strong>{t('jobs.viberReady')}</strong>
          <p className="viber-text small">{viber.text}</p>
          <a className="btn btn-primary" href={viber.url} target="_blank" rel="noopener">
            {t('viber.open')}
          </a>{' '}
          <button type="button" className="btn btn-small" onClick={() => setViber(null)}>
            {t('common.close')}
          </button>
        </div>
      ) : null}
      {panel === 'approve' ? (
        <form
          className="card narrow"
          onSubmit={submit(
            () =>
              post(`/jobs/${job.id}/transition`, {
                to: 'approved',
                evidence: { kind: evKind, by: evBy || null, note: evNote || null },
              }),
            t('jobs.approved'),
          )}
        >
          <h2>{t('jobs.approve')}</h2>
          <p className="muted small">{t('jobs.evidenceHint')}</p>
          <Field label={t('jobs.evidenceKind')} required>
            <EnumSelect
              value={evKind}
              options={EvidenceEnum.options}
              prefix="enum.approvalEvidenceKind"
              onChange={(v) => v && setEvKind(v)}
            />
          </Field>
          <Field label={t('jobs.evidenceBy')}>
            <input value={evBy} onChange={(e) => setEvBy(e.target.value)} />
          </Field>
          <Field label={t('jobs.evidenceNote')}>
            <textarea rows={2} value={evNote} onChange={(e) => setEvNote(e.target.value)} />
          </Field>
          <div className="actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {t('jobs.approve')}
            </button>
            <button type="button" className="btn" onClick={() => setPanel('none')}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      ) : null}
      {panel === 'schedule' ? (
        <form
          className="card narrow"
          onSubmit={submit(
            () =>
              post(`/jobs/${job.id}/schedule`, {
                scheduledAt: localInputToIso(schedAt),
                assignedUserIds: schedUsers,
              }),
            t('jobs.scheduled'),
          )}
        >
          <h2>{t('jobs.schedule')}</h2>
          <Field label={t('jobs.scheduledAt')} required>
            <input
              type="datetime-local"
              value={schedAt}
              onChange={(e) => setSchedAt(e.target.value)}
              required
            />
          </Field>
          <Field label={t('jobs.technicians')} required hint={t('jobs.techniciansHint')}>
            <div className="check-list">
              {users.map((u) => (
                <label key={u.id} className="check">
                  <input
                    type="checkbox"
                    checked={schedUsers.includes(u.id)}
                    onChange={(e) =>
                      setSchedUsers((s) =>
                        e.target.checked ? [...s, u.id] : s.filter((x) => x !== u.id),
                      )
                    }
                  />
                  <span>{u.name}</span>
                </label>
              ))}
              {users.length === 0 ? (
                <span className="muted small">{t('jobs.noTechnicians')}</span>
              ) : null}
            </div>
          </Field>
          <div className="actions">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={busy || schedUsers.length === 0}
            >
              {t('jobs.schedule')}
            </button>
            <button type="button" className="btn" onClick={() => setPanel('none')}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      ) : null}
      {panel === 'complete' ? (
        <form
          className="card narrow"
          onSubmit={submit(
            () =>
              post(`/jobs/${job.id}/complete`, {
                at: localInputToIso(doneAt),
                notes: doneNotes || null,
                partsUsed: doneParts || null,
                warrantyMonths: warranty === '' ? null : Number(warranty),
                createVisit,
                attachments: [],
              }),
            t('jobs.completed'),
          )}
        >
          <h2>{t('jobs.complete')}</h2>
          <p className="muted small">{t('jobs.completeHint')}</p>
          <Field label={t('jobs.completedAt')} required>
            <input
              type="datetime-local"
              value={doneAt}
              onChange={(e) => setDoneAt(e.target.value)}
              required
            />
          </Field>
          <Field label={t('common.notes')}>
            <textarea rows={3} value={doneNotes} onChange={(e) => setDoneNotes(e.target.value)} />
          </Field>
          <Field label={t('jobs.partsUsed')}>
            <input value={doneParts} onChange={(e) => setDoneParts(e.target.value)} />
          </Field>
          <Field label={t('jobs.warrantyMonths')}>
            <input
              type="number"
              min={0}
              max={120}
              value={warranty}
              onChange={(e) => setWarranty(e.target.value)}
            />
          </Field>
          <label className="check">
            <input
              type="checkbox"
              checked={createVisit}
              onChange={(e) => setCreateVisit(e.target.checked)}
            />
            <span>{t('jobs.createVisit')}</span>
          </label>
          <div className="actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {t('jobs.complete')}
            </button>
            <button type="button" className="btn" onClick={() => setPanel('none')}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      ) : null}
      {panel === 'invoice' ? (
        <form
          className="card narrow"
          onSubmit={submit(
            () =>
              post(`/jobs/${job.id}/invoice`, {
                kind: invKind,
                amountCents: invKind === 'partial' ? toCents(invAmount) : undefined,
                issuedAt: invIssuedAt,
              }),
            t('jobs.invoiced'),
          )}
        >
          <h2>{t('jobs.createInvoice')}</h2>
          <Field label={t('jobs.invoiceKind')}>
            <select
              value={invKind}
              onChange={(e) => setInvKind(e.target.value as 'full' | 'partial')}
            >
              {next.includes('invoiced') ? (
                <option value="full">{t('jobs.invoiceFull', { amount: money(remaining) })}</option>
              ) : null}
              <option value="partial">{t('jobs.invoicePartial')}</option>
            </select>
          </Field>
          {invKind === 'partial' ? (
            <Field
              label={t('jobs.invoiceAmountEur')}
              required
              hint={t('jobs.remaining', { amount: money(remaining) })}
            >
              <input
                inputMode="decimal"
                value={invAmount}
                onChange={(e) => setInvAmount(e.target.value)}
                required
              />
            </Field>
          ) : null}
          <Field label={t('billing.doc.issuedAt')}>
            <input
              type="date"
              value={invIssuedAt}
              max={todaySofia()}
              onChange={(e) => setInvIssuedAt(e.target.value)}
            />
          </Field>
          <div className="actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {t('jobs.createInvoice')}
            </button>
            <button type="button" className="btn" onClick={() => setPanel('none')}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      ) : null}
      {panel === 'reject' || panel === 'cancel' ? (
        <form
          className="card narrow"
          onSubmit={submit(
            () => post(`/jobs/${job.id}/${panel}`, { reason }),
            panel === 'reject' ? t('jobs.rejected') : t('jobs.cancelled'),
          )}
        >
          <h2>{panel === 'reject' ? t('jobs.reject') : t('jobs.cancel')}</h2>
          <Field label={t('jobs.reason')} required>
            <textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
            />
          </Field>
          <div className="actions">
            <button type="submit" className="btn btn-danger" disabled={busy || !reason.trim()}>
              {t('common.confirm')}
            </button>
            <button type="button" className="btn" onClick={() => setPanel('none')}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      ) : null}
      {panel === 'transition' ? (
        <form
          className="card narrow"
          onSubmit={submit(
            () => post(`/jobs/${job.id}/transition`, { to: target, reason: reason || null }),
            t('common.saved'),
          )}
        >
          <h2>{t('jobs.moveTo')}</h2>
          <Field label={t('jobs.stage')}>
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              {genericTargets.map((c) => (
                <option key={c} value={c}>
                  {stageLabel(cfg.stages, c, locale, t)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('jobs.reason')}>
            <input value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div className="actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {t('common.save')}
            </button>
            <button type="button" className="btn" onClick={() => setPanel('none')}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      ) : null}

      <div className="grid-2">
        <div className="card">
          <h2>{t('jobs.quote.title')}</h2>
          <div className="table-wrap">
            <table className="table compact job-lines">
              <thead>
                <tr>
                  <th>{t('jobs.line.kind')}</th>
                  <th>{t('jobs.line.description')}</th>
                  <th className="num">{t('jobs.line.qty')}</th>
                  <th className="num">{t('jobs.line.unit')}</th>
                  <th className="num">{t('jobs.line.total')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {job.lines.map((l) => (
                  <LineRow
                    key={l.id}
                    line={l}
                    editable={editable}
                    onSave={(p) => act(() => patch(`/jobs/${job.id}/lines/${l.id}`, p))}
                    onRemove={() => act(() => del(`/jobs/${job.id}/lines/${l.id}`))}
                  />
                ))}
                {job.lines.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="muted">
                      {t('jobs.lines.empty')}
                    </td>
                  </tr>
                ) : null}
                {editable ? (
                  <tr className="row-form">
                    <td>
                      <EnumSelect
                        value={newLine.kind}
                        options={JobLineKindEnum.options}
                        prefix="enum.jobLineKind"
                        onChange={(v) => v && setNewLine((s) => ({ ...s, kind: v }))}
                      />
                    </td>
                    <td>
                      <input
                        value={newLine.description}
                        placeholder={t('jobs.line.placeholder')}
                        onChange={(e) => setNewLine((s) => ({ ...s, description: e.target.value }))}
                      />
                    </td>
                    <td className="num">
                      <input
                        className="num-input"
                        inputMode="decimal"
                        value={newLine.qty}
                        onChange={(e) => setNewLine((s) => ({ ...s, qty: e.target.value }))}
                      />
                    </td>
                    <td className="num">
                      <input
                        className="num-input"
                        inputMode="decimal"
                        value={newLine.unit}
                        placeholder="0.00"
                        onChange={(e) => setNewLine((s) => ({ ...s, unit: e.target.value }))}
                      />
                    </td>
                    <td className="num">
                      {money(
                        Math.round(
                          (Number(newLine.qty.replace(',', '.')) || 0) * toCents(newLine.unit),
                        ),
                      )}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-small btn-primary"
                        disabled={busy || !newLine.description.trim()}
                        onClick={() =>
                          act(async () => {
                            await post(`/jobs/${job.id}/lines`, {
                              kind: newLine.kind,
                              description: newLine.description.trim(),
                              qty: Number(newLine.qty.replace(',', '.')) || 0,
                              unitCents: toCents(newLine.unit),
                              partRef: newLine.partRef || null,
                            })
                            setNewLine({
                              kind: 'part',
                              description: '',
                              qty: '1',
                              unit: '',
                              partRef: '',
                            })
                          })
                        }
                      >
                        {t('jobs.addLine')}
                      </button>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <dl className="totals-dl">
            <dt>{t('billing.doc.net')}</dt>
            <dd>{moneyFull(job.netCents)}</dd>
            <dt>
              {t('billing.doc.vat')} {job.vatRatePercent}%
            </dt>
            <dd>{moneyFull(job.vatCents)}</dd>
            <dt>{t('billing.doc.total')}</dt>
            <dd>
              <strong>{moneyFull(job.totalCents)}</strong>
            </dd>
            {job.invoicedCents > 0 ? (
              <>
                <dt>{t('jobs.invoicedSoFar')}</dt>
                <dd>{moneyFull(job.invoicedCents)}</dd>
              </>
            ) : null}
          </dl>
          {!editable && canEdit && !job.isTerminal ? (
            <p className="muted small">{t('jobs.linesLockedHint')}</p>
          ) : null}
          {job.previousLines.length ? (
            <div>
              <button
                type="button"
                className="linkish small"
                onClick={() => setShowHistory((v) => !v)}
              >
                {t('jobs.quoteHistory', { count: job.previousLines.length })}
              </button>
              {showHistory ? (
                <table className="table compact">
                  <tbody>
                    {job.previousLines.map((l) => (
                      <tr key={l.id} className="muted">
                        <td>{t('jobs.quote.version', { n: l.quoteVersion })}</td>
                        <td>{l.description}</td>
                        <td className="num">{number(l.qty, { maximumFractionDigits: 3 })}</td>
                        <td className="num">{money(l.unitCents)}</td>
                        <td className="num">{money(l.totalCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="card">
          <h2>{t('jobs.details')}</h2>
          <dl className="dl">
            <dt>{t('elevators.one')}</dt>
            <dd>
              <Link to={`/elevators/${job.elevatorId}`}>{job.elevatorInternalNo}</Link>
              {' · '}
              <Link to={`/buildings/${job.buildingId}`}>{job.buildingAddressText}</Link>
            </dd>
            <dt>{t('buildings.customer')}</dt>
            <dd>
              {job.customerId ? (
                <Link to={`/customers/${job.customerId}`}>{job.customerName ?? '—'}</Link>
              ) : (
                <span className="muted">—</span>
              )}
            </dd>
            <dt>{t('jobs.origin')}</dt>
            <dd>
              {t(`enum.jobOriginType.${job.originType}`)}
              {job.originId && job.originType === 'defect' ? (
                <>
                  {' '}
                  · <Link to={`/defects`}>{t('defects.one')}</Link>
                </>
              ) : null}
              {job.originId && job.originType === 'callback' ? (
                <>
                  {' '}
                  · <Link to={`/callbacks?tab=history`}>{t('callbacks.one')}</Link>
                </>
              ) : null}
              {job.originId && job.originType === 'visit' ? (
                <>
                  {' '}
                  ·{' '}
                  <a href={`${BASE}/print/logbook/${job.originId}`} target="_blank" rel="noopener">
                    {t('visits.one')}
                  </a>
                </>
              ) : null}
            </dd>
            {job.description ? (
              <>
                <dt>{t('jobs.description')}</dt>
                <dd className="pre">{job.description}</dd>
              </>
            ) : null}
            {job.quoteSentAt ? (
              <>
                <dt>{t('jobs.sentAt')}</dt>
                <dd>
                  {dateTime(job.quoteSentAt)}
                  {job.quoteValidUntil
                    ? ` · ${t('jobs.quote.validUntil', { date: date(job.quoteValidUntil) })}`
                    : ''}
                </dd>
              </>
            ) : null}
            {job.approvalEvidence ? (
              <>
                <dt>{t('jobs.approval')}</dt>
                <dd>
                  {t(`enum.approvalEvidenceKind.${job.approvalEvidence.kind}`)}
                  {job.approvalEvidence.by ? ` · ${job.approvalEvidence.by}` : ''}
                  {job.approvalEvidence.at ? ` · ${dateTime(job.approvalEvidence.at)}` : ''}
                  {job.approvalEvidence.note ? (
                    <div className="small muted">{job.approvalEvidence.note}</div>
                  ) : null}
                </dd>
              </>
            ) : null}
            {job.scheduledAt ? (
              <>
                <dt>{t('jobs.scheduledAt')}</dt>
                <dd>
                  {dateTime(job.scheduledAt)}
                  {job.assignedUserNames.length ? ` · ${job.assignedUserNames.join(', ')}` : ''}
                </dd>
              </>
            ) : null}
            {job.startedAt ? (
              <>
                <dt>{t('jobs.startedAt')}</dt>
                <dd>{dateTime(job.startedAt)}</dd>
              </>
            ) : null}
            {job.completedAt ? (
              <>
                <dt>{t('jobs.completedAt')}</dt>
                <dd>{dateTime(job.completedAt)}</dd>
              </>
            ) : null}
            {job.warrantyUntil ? (
              <>
                <dt>{t('jobs.warrantyUntil')}</dt>
                <dd>{date(job.warrantyUntil)}</dd>
              </>
            ) : null}
            {job.visitId ? (
              <>
                <dt>{t('visits.one')}</dt>
                <dd>
                  <a href={`${BASE}/print/logbook/${job.visitId}`} target="_blank" rel="noopener">
                    {t('jobs.openVisit')}
                  </a>
                </dd>
              </>
            ) : null}
            {job.rejectedReason ? (
              <>
                <dt>{t('jobs.rejectedReason')}</dt>
                <dd>{job.rejectedReason}</dd>
              </>
            ) : null}
            {job.cancelledReason ? (
              <>
                <dt>{t('jobs.cancelledReason')}</dt>
                <dd>{job.cancelledReason}</dd>
              </>
            ) : null}
            {job.notes ? (
              <>
                <dt>{t('common.notes')}</dt>
                <dd className="pre">{job.notes}</dd>
              </>
            ) : null}
          </dl>
          {job.invoices.length ? (
            <>
              <h3 className="sub-head">{t('invoices.title')}</h3>
              <table className="table compact">
                <tbody>
                  {job.invoices.map((inv) => (
                    <tr key={inv.id}>
                      <td>
                        <Link to={`/invoices/${inv.id}`}>№ {inv.number}</Link>
                      </td>
                      <td>{date(inv.issuedAt)}</td>
                      <td className="num">{moneyFull(inv.totalCents)}</td>
                      <td>
                        <Badge kind={invoiceStatusBadge(inv.status as never)}>
                          {t(`enum.invoiceStatus.${inv.status}`)}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}
          <h3 className="sub-head">{t('jobs.timeline')}</h3>
          <ul className="timeline">
            {job.events.map((e) => (
              <li key={e.id}>
                <span className="muted small">{dateTime(e.at)}</span>{' '}
                <strong>
                  {e.toStatus
                    ? stageLabel(cfg.stages, e.toStatus, locale, t)
                    : t(`jobs.event.${e.type}`)}
                </strong>
                {e.byUserName ? <span className="muted small"> · {e.byUserName}</span> : null}
                <span className="muted small"> · {t(`enum.eventSource.${e.source}`)}</span>
                {typeof e.data.notes === 'string' ? (
                  <div className="small">{e.data.notes}</div>
                ) : null}
                {typeof e.data.reason === 'string' ? (
                  <div className="small">{e.data.reason}</div>
                ) : null}
                {typeof e.data.channel === 'string' ? (
                  <div className="small muted">
                    {t('jobs.channel')}: {String(e.data.channel)}
                    {e.data.to ? ` → ${String(e.data.to)}` : ''}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          {canEdit && !job.isTerminal ? (
            <button
              type="button"
              className="btn btn-small btn-danger-outline"
              onClick={() => navigate('/jobs')}
            >
              {t('common.back')}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
