import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type {
  DefectCatalogItemDto,
  DefectDto,
  DefectSeverity,
  ElevatorDto,
} from '@avroleva/contracts'
import { DefectSeverity as DefectSeverityEnum } from '@avroleva/contracts'
import { ApiError, get, post } from '../../lib/api'
import { useI18n } from '../../i18n/I18nProvider'
import { ErrorBox, Field, toast } from '../ui'
import { EnumSelect } from '../EnumSelect'
import { ElevatorSearch } from '../ElevatorSearch'

/** Catalogue picker (17 items + free text) with the stop-lift flag pre-set from the item. */
export function RecordDefectForm({
  elevator: fixedElevator,
  onDone,
  onCancel,
}: {
  elevator?: ElevatorDto | null
  onDone: (d: DefectDto) => void
  onCancel: () => void
}) {
  const { t } = useI18n()
  const [catalog, setCatalog] = useState<DefectCatalogItemDto[]>([])
  const [elevator, setElevator] = useState<ElevatorDto | null>(fixedElevator ?? null)
  const [code, setCode] = useState('other')
  const [description, setDescription] = useState('')
  const [severity, setSeverity] = useState<DefectSeverity>('medium')
  const [stopLift, setStopLift] = useState(false)
  const [notes, setNotes] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    get<{ items: DefectCatalogItemDto[] }>('/defects/catalog')
      .then((r) => !cancelled && setCatalog(r.items))
      .catch((e) => !cancelled && setError(e))
    return () => {
      cancelled = true
    }
  }, [])

  const pick = (c: string) => {
    setCode(c)
    const item = catalog.find((i) => i.code === c)
    setStopLift(item?.stopLift ?? false)
    setSeverity(item && item.code !== 'other' ? 'high' : 'medium')
  }
  const item = catalog.find((i) => i.code === code)
  const isOther = !item || item.code === 'other'

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!elevator) {
      setErrors({ elevatorId: t('callbacks.elevatorRequired') })
      return
    }
    setBusy(true)
    setError(null)
    setErrors({})
    try {
      const d = await post<DefectDto>('/defects', {
        elevatorId: elevator.id,
        catalogCode: code,
        description: description.trim() || null,
        severity,
        stopLift,
        sourceType: 'office',
        notes: notes.trim() || null,
      })
      toast(t('defects.recorded'))
      onDone(d)
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) setErrors(err.fieldErrors)
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="cb-intake" onSubmit={submit}>
      <ErrorBox error={error} />
      <ElevatorSearch
        value={elevator}
        onChange={setElevator}
        error={errors.elevatorId}
        autoFocus={!fixedElevator}
      />
      <Field label={t('defects.catalog')} error={errors.catalogCode} required>
        <select value={code} onChange={(e) => pick(e.target.value)}>
          {catalog.map((c) => (
            <option key={c.code} value={c.code}>
              {c.ref ? `${c.ref} — ` : ''}
              {c.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t('defects.description')} error={errors.description} required={isOther}>
        <textarea
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required={isOther}
          maxLength={2000}
        />
      </Field>
      <div className="row checks">
        <Field label={t('defects.severity')} error={errors.severity}>
          <EnumSelect
            value={severity}
            options={DefectSeverityEnum.options}
            prefix="enum.defectSeverity"
            onChange={(v) => v && setSeverity(v)}
          />
        </Field>
        <label className="check">
          <input
            type="checkbox"
            checked={stopLift}
            onChange={(e) => setStopLift(e.target.checked)}
          />
          <span>{t('defects.stopLift')}</span>
        </label>
      </div>
      {stopLift ? <p className="muted small">{t('defects.stopLiftHint')}</p> : null}
      <Field label={t('common.notes')} error={errors.notes}>
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {t('defects.record')}
        </button>
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  )
}
