import { useState } from 'react'
import type { FormEvent } from 'react'
import type {
  ElevatorDto,
  InspectionDto,
  InspectionKind,
  InspectionResult,
} from '@avroleva/contracts'
import {
  InspectionKind as InspectionKindEnum,
  InspectionResult as InspectionResultEnum,
} from '@avroleva/contracts'
import { ApiError, patch, post } from '../../lib/api'
import { useI18n } from '../../i18n/I18nProvider'
import { ErrorBox, Field, toast } from '../ui'
import { EnumSelect } from '../EnumSelect'
import { ElevatorSearch } from '../ElevatorSearch'

interface DefectLine {
  text: string
  deadline: string
  closed: boolean
}

/** Create or edit an inspection: dates, result, body, findings with deadlines, next due. */
export function InspectionForm({
  elevator: fixedElevator,
  existing,
  onDone,
  onCancel,
}: {
  elevator?: ElevatorDto | null
  existing?: InspectionDto | null
  onDone: (i: InspectionDto) => void
  onCancel: () => void
}) {
  const { t } = useI18n()
  const [elevator, setElevator] = useState<ElevatorDto | null>(fixedElevator ?? null)
  const [kind, setKind] = useState<InspectionKind>(existing?.kind ?? 'periodic')
  const [requestedAt, setRequestedAt] = useState(existing?.requestedAt ?? '')
  const [scheduledAt, setScheduledAt] = useState(existing?.scheduledAt ?? '')
  const [performedAt, setPerformedAt] = useState(existing?.performedAt ?? '')
  const [result, setResult] = useState<InspectionResult>(existing?.result ?? 'pending')
  const [body, setBody] = useState(existing?.inspectionBody ?? fixedElevator?.inspectionBody ?? '')
  const [nextDueAt, setNextDueAt] = useState(existing?.nextDueAt ?? '')
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [defects, setDefects] = useState<DefectLine[]>(
    existing?.defects.map((d) => ({
      text: d.text,
      deadline: d.deadline ?? '',
      closed: d.closed,
    })) ?? [],
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!existing && !elevator) {
      setErrors({ elevatorId: t('callbacks.elevatorRequired') })
      return
    }
    setBusy(true)
    setError(null)
    setErrors({})
    const payload = {
      kind,
      requestedAt: requestedAt || null,
      scheduledAt: scheduledAt || null,
      performedAt: performedAt || null,
      result: performedAt ? result : 'pending',
      inspectionBody: body.trim() || null,
      nextDueAt: nextDueAt || undefined,
      notes: notes.trim() || null,
      defects: defects
        .filter((d) => d.text.trim())
        .map((d) => ({ text: d.text.trim(), deadline: d.deadline || null, closed: d.closed })),
    }
    try {
      const i = existing
        ? await patch<InspectionDto>(`/inspections/${existing.id}`, {
            ...payload,
            nextDueAt: nextDueAt || null,
          })
        : await post<InspectionDto>('/inspections', { ...payload, elevatorId: elevator!.id })
      toast(t('inspections.recorded'))
      onDone(i)
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) setErrors(err.fieldErrors)
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  const setLine = (i: number, patchLine: Partial<DefectLine>) =>
    setDefects((ds) => ds.map((d, j) => (j === i ? { ...d, ...patchLine } : d)))

  return (
    <form className="cb-intake" onSubmit={submit}>
      <ErrorBox error={error} />
      {existing ? null : (
        <ElevatorSearch
          value={elevator}
          onChange={setElevator}
          error={errors.elevatorId}
          autoFocus={!fixedElevator}
        />
      )}
      <div className="row">
        <Field label={t('inspections.kind')} error={errors.kind}>
          <EnumSelect
            value={kind}
            options={InspectionKindEnum.options}
            prefix="enum.inspectionKind"
            onChange={(v) => v && setKind(v)}
          />
        </Field>
        <Field label={t('inspections.body')} error={errors.inspectionBody}>
          <input value={body} onChange={(e) => setBody(e.target.value)} maxLength={200} />
        </Field>
      </div>
      <div className="row">
        <Field label={t('inspections.requestedAt')} error={errors.requestedAt}>
          <input type="date" value={requestedAt} onChange={(e) => setRequestedAt(e.target.value)} />
        </Field>
        <Field label={t('inspections.scheduledAt')} error={errors.scheduledAt}>
          <input type="date" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
        </Field>
        <Field label={t('inspections.performedAt')} error={errors.performedAt}>
          <input type="date" value={performedAt} onChange={(e) => setPerformedAt(e.target.value)} />
        </Field>
      </div>
      <div className="row">
        <Field label={t('inspections.result')} error={errors.result} required={!!performedAt}>
          <EnumSelect
            value={result}
            options={InspectionResultEnum.options}
            prefix="enum.inspectionResult"
            disabled={!performedAt}
            onChange={(v) => v && setResult(v)}
          />
        </Field>
        <Field
          label={t('inspections.nextDueAt')}
          error={errors.nextDueAt}
          hint={t('inspections.nextDueHint')}
        >
          <input type="date" value={nextDueAt} onChange={(e) => setNextDueAt(e.target.value)} />
        </Field>
      </div>
      <div className="field">
        <span className="field-label">{t('inspections.defects')}</span>
        {defects.map((d, i) => (
          <div key={i} className="row inline-form-row">
            <input
              placeholder={t('inspections.defectText')}
              value={d.text}
              onChange={(e) => setLine(i, { text: e.target.value })}
              maxLength={500}
            />
            <input
              type="date"
              title={t('inspections.defectDeadline')}
              value={d.deadline}
              onChange={(e) => setLine(i, { deadline: e.target.value })}
            />
            <label className="check">
              <input
                type="checkbox"
                checked={d.closed}
                onChange={(e) => setLine(i, { closed: e.target.checked })}
              />
              <span>{t('inspections.defectClosed')}</span>
            </label>
          </div>
        ))}
        <button
          type="button"
          className="btn btn-small"
          onClick={() => setDefects((ds) => [...ds, { text: '', deadline: '', closed: false }])}
        >
          {t('inspections.addDefect')}
        </button>
      </div>
      <Field label={t('common.notes')} error={errors.notes}>
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {t('inspections.record')}
        </button>
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  )
}
