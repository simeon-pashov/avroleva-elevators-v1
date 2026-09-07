import { useState } from 'react'
import type { FormEvent } from 'react'
import type {
  CallbackChannel,
  CallbackClassification,
  CallbackDto,
  ElevatorDto,
} from '@avroleva/contracts'
import {
  CallbackChannel as CallbackChannelEnum,
  CallbackClassification as CallbackClassificationEnum,
} from '@avroleva/contracts'
import { ApiError, post } from '../../lib/api'
import { localInputToIso, nowLocalInput } from '../../lib/dates'
import { useI18n } from '../../i18n/I18nProvider'
import { useAuth } from '../../auth/AuthProvider'
import { ErrorBox, Field, toast } from '../ui'
import { EnumSelect } from '../EnumSelect'
import { ElevatorSearch } from '../ElevatorSearch'
import { useTechnicians } from './CallbackList'

/**
 * "Three taps" intake: pick the elevator, the type, describe, optionally dispatch. The callback id
 * is generated client-side so a retried submit cannot create a duplicate.
 */
export function CallbackIntakeForm({
  elevator: fixedElevator,
  onDone,
  onCancel,
}: {
  elevator?: ElevatorDto | null
  onDone: (c: CallbackDto) => void
  onCancel: () => void
}) {
  const { t } = useI18n()
  const { hasRole } = useAuth()
  const isOffice = hasRole('owner', 'office')
  const users = useTechnicians(isOffice)
  const [id] = useState(() => crypto.randomUUID())
  const [elevator, setElevator] = useState<ElevatorDto | null>(fixedElevator ?? null)
  const [channel, setChannel] = useState<CallbackChannel>('phone')
  const [classification, setClassification] = useState<CallbackClassification>('breakdown')
  const [trappedCount, setTrappedCount] = useState('1')
  const [callerName, setCallerName] = useState('')
  const [callerPhone, setCallerPhone] = useState('')
  const [description, setDescription] = useState('')
  const [receivedAt, setReceivedAt] = useState(nowLocalInput)
  const [assignedUserId, setAssignedUserId] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

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
      const c = await post<CallbackDto>('/callbacks', {
        id,
        elevatorId: elevator.id,
        channel,
        classification,
        trappedCount: classification === 'trapped_persons' ? Number(trappedCount || 1) : null,
        callerName: callerName.trim() || null,
        callerPhone: callerPhone.trim() || null,
        description: description.trim(),
        receivedAt: localInputToIso(receivedAt),
        assignedUserId: assignedUserId || null,
      })
      toast(t('callbacks.opened'))
      onDone(c)
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
      <div className="row">
        <Field label={t('callbacks.classification')} error={errors.classification} required>
          <EnumSelect
            value={classification}
            options={CallbackClassificationEnum.options}
            prefix="enum.callbackClassification"
            onChange={(v) => v && setClassification(v)}
          />
        </Field>
        {classification === 'trapped_persons' ? (
          <Field label={t('callbacks.trappedCount')} error={errors.trappedCount}>
            <input
              type="number"
              min={0}
              max={50}
              value={trappedCount}
              onChange={(e) => setTrappedCount(e.target.value)}
            />
          </Field>
        ) : null}
        <Field label={t('callbacks.channel')} error={errors.channel}>
          <EnumSelect
            value={channel}
            options={CallbackChannelEnum.options.filter((c) => c !== 'public_page')}
            prefix="enum.callbackChannel"
            onChange={(v) => v && setChannel(v)}
          />
        </Field>
      </div>
      <Field label={t('callbacks.description')} error={errors.description} required>
        <textarea
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
          maxLength={2000}
        />
      </Field>
      <div className="row">
        <Field label={t('callbacks.callerName')} error={errors.callerName}>
          <input
            value={callerName}
            onChange={(e) => setCallerName(e.target.value)}
            maxLength={120}
          />
        </Field>
        <Field label={t('callbacks.callerPhone')} error={errors.callerPhone}>
          <input
            type="tel"
            value={callerPhone}
            onChange={(e) => setCallerPhone(e.target.value)}
            maxLength={25}
          />
        </Field>
        <Field label={t('callbacks.receivedAt')} error={errors.receivedAt}>
          <input
            type="datetime-local"
            value={receivedAt}
            max={nowLocalInput()}
            onChange={(e) => setReceivedAt(e.target.value)}
          />
        </Field>
      </div>
      {isOffice ? (
        <Field label={t('callbacks.dispatchNow')} error={errors.assignedUserId}>
          <select value={assignedUserId} onChange={(e) => setAssignedUserId(e.target.value)}>
            <option value="">{t('callbacks.noDispatch')}</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({t(`enum.userRole.${u.role}`)})
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {t('callbacks.save')}
        </button>
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  )
}
