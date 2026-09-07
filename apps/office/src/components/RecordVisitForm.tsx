import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import type { UserDto, VisitDto, VisitKind, VisitSource } from '@avroleva/contracts'
import { VisitKind as VisitKindEnum } from '@avroleva/contracts'
import { ApiError, get, post } from '../lib/api'
import { localInputToIso, nowLocalInput } from '../lib/dates'
import { useI18n } from '../i18n/I18nProvider'
import { useAuth } from '../auth/AuthProvider'
import { ErrorBox, Field, toast } from './ui'
import { EnumSelect } from './EnumSelect'

const SOURCES: readonly VisitSource[] = ['office', 'paper']

/**
 * Inline "Отбележи посещение" form. Owner/office pick technicians from the active users (the
 * current user is preselected) and may add one free-text name; technicians type a name.
 * The visit id is generated client-side so a retried submit cannot create a duplicate.
 */
export function RecordVisitForm({
  elevatorId,
  onDone,
  onCancel,
}: {
  elevatorId: string
  onDone: (visit: VisitDto) => void
  onCancel: () => void
}) {
  const { t } = useI18n()
  const { me, hasRole } = useAuth()
  const canPickUsers = hasRole('owner', 'office')
  const visitId = useMemo(() => crypto.randomUUID(), [])

  const [startedAt, setStartedAt] = useState(nowLocalInput)
  const [kind, setKind] = useState<VisitKind>('functional_check')
  const [source, setSource] = useState<VisitSource>('office')
  const [notes, setNotes] = useState('')
  const [users, setUsers] = useState<UserDto[]>([])
  const [selected, setSelected] = useState<string[]>(() => (me && canPickUsers ? [me.user.id] : []))
  const [extraName, setExtraName] = useState(() => (canPickUsers ? '' : (me?.user.name ?? '')))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!canPickUsers) return
    let cancelled = false
    get<{ items: UserDto[] }>('/users')
      .then((r) => {
        if (cancelled) return
        setUsers(r.items.filter((u) => u.isActive))
      })
      .catch((e) => !cancelled && setError(e))
    return () => {
      cancelled = true
    }
  }, [canPickUsers])

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const technicians: Array<{ userId?: string; name?: string }> = selected.map((userId) => ({
      userId,
    }))
    if (extraName.trim()) technicians.push({ name: extraName.trim() })
    if (technicians.length === 0) {
      setErrors({ technicians: t('visits.techniciansRequired') })
      return
    }
    setBusy(true)
    setError(null)
    setErrors({})
    try {
      const visit = await post<VisitDto>('/visits', {
        id: visitId,
        elevatorId,
        kind,
        startedAt: localInputToIso(startedAt),
        technicians,
        notes: notes.trim() || null,
        source,
      })
      toast(t('visits.recorded'))
      onDone(visit)
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) setErrors(err.fieldErrors)
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  const techError =
    errors.technicians ??
    Object.entries(errors).find(([k]) => k.startsWith('technicians'))?.[1] ??
    undefined

  return (
    <form className="visit-form" onSubmit={submit}>
      <ErrorBox error={error} />
      <div className="row">
        <Field label={t('visits.startedAt')} error={errors.startedAt} required>
          <input
            type="datetime-local"
            value={startedAt}
            max={nowLocalInput()}
            onChange={(e) => setStartedAt(e.target.value)}
            required
          />
        </Field>
        <Field label={t('visits.kind')} error={errors.kind} required>
          <EnumSelect
            value={kind}
            options={VisitKindEnum.options}
            prefix="enum.visitKind"
            onChange={(v) => v && setKind(v)}
          />
        </Field>
      </div>
      {canPickUsers ? (
        <div className={`field${techError ? ' has-error' : ''}`}>
          <span className="field-label">
            {t('visits.technicians')}
            <span className="req"> *</span>
          </span>
          <div className="check-list">
            {users.map((u) => (
              <label key={u.id} className="check">
                <input
                  type="checkbox"
                  checked={selected.includes(u.id)}
                  onChange={() => toggle(u.id)}
                />
                <span>{u.name}</span>
                <span className="muted small">{t(`enum.userRole.${u.role}`)}</span>
              </label>
            ))}
          </div>
          {techError ? <span className="field-error">{techError}</span> : null}
        </div>
      ) : null}
      <div className="row">
        <Field
          label={t(canPickUsers ? 'visits.technicianName' : 'visits.technicianNameSelf')}
          hint={canPickUsers ? t('visits.technicianNameHint') : undefined}
          error={canPickUsers ? undefined : techError}
          required={!canPickUsers}
        >
          <input value={extraName} onChange={(e) => setExtraName(e.target.value)} maxLength={120} />
        </Field>
        <Field label={t('visits.source')} error={errors.source}>
          <EnumSelect
            value={source}
            options={SOURCES}
            prefix="enum.visitSource"
            onChange={(v) => v && setSource(v)}
          />
        </Field>
      </div>
      <Field label={t('common.notes')} error={errors.notes}>
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {t('visits.save')}
        </button>
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  )
}
