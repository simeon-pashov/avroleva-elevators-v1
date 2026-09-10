import { useState } from 'react'
import type { TechnicianPairDto, UserDto, ZoneDto } from '@avroleva/contracts'
import { del, patch, post } from '../../lib/api'
import { useI18n } from '../../i18n/I18nProvider'
import { Badge, ConfirmButton, Empty, ErrorBox, Field, toast } from '../../components/ui'
import { strOrNull, useForm } from '../../components/useForm'

interface PairForm {
  name: string
  /** Three technician slots; '' = empty slot. */
  userIds: [string, string, string]
  vehicle: string
  defaultZoneId: string
}

const EMPTY: PairForm = { name: '', userIds: ['', '', ''], vehicle: '', defaultZoneId: '' }

const toSlots = (ids: string[]): [string, string, string] => [
  ids[0] ?? '',
  ids[1] ?? '',
  ids[2] ?? '',
]

/** Settings -> Планиране -> Екипи: the pair table and the inline create/edit form (owner only). */
export function PairsEditor({
  pairs,
  zones,
  users,
  canEdit,
  onChanged,
}: {
  pairs: TechnicianPairDto[]
  zones: ZoneDto[]
  users: UserDto[]
  canEdit: boolean
  onChanged: () => Promise<void>
}) {
  const { t } = useI18n()
  const [editing, setEditing] = useState<TechnicianPairDto | 'new' | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const form = useForm<PairForm>(EMPTY)

  const technicians = users.filter((u) => u.role === 'technician' && u.isActive)
  const activeZones = zones.filter((z) => z.active)
  const zoneName = (id: string | null) => (id ? (zones.find((z) => z.id === id)?.name ?? '') : '')

  const open = (target: TechnicianPairDto | 'new') => {
    setError(null)
    setLocalError(null)
    form.setValues(
      target === 'new'
        ? EMPTY
        : {
            name: target.name,
            userIds: toSlots(target.userIds),
            vehicle: target.vehicle ?? '',
            defaultZoneId: target.defaultZoneId ?? '',
          },
    )
    setEditing(target)
  }
  const close = () => setEditing(null)

  const save = () =>
    form.submit(async (v) => {
      const userIds = v.userIds.filter(Boolean)
      if (userIds.length === 0) {
        setLocalError(t('pairs.needTechnician'))
        return
      }
      if (new Set(userIds).size !== userIds.length) {
        setLocalError(t('pairs.duplicateUsers'))
        return
      }
      setLocalError(null)
      const body = {
        name: v.name,
        userIds,
        vehicle: strOrNull(v.vehicle),
        defaultZoneId: v.defaultZoneId || null,
      }
      if (editing === 'new') await post('/technician-pairs', body)
      else if (editing) await patch(`/technician-pairs/${editing.id}`, body)
      toast(t('common.saved'))
      close()
      await onChanged()
    })

  const archive = async (p: TechnicianPairDto) => {
    try {
      await del(`/technician-pairs/${p.id}`)
      toast(t('common.archived'))
      if (editing !== 'new' && editing?.id === p.id) close()
      await onChanged()
    } catch (e) {
      setError(e)
    }
  }

  const editingPair = editing && editing !== 'new' ? editing : null
  const v = form.values
  const err = form.errors

  /** Options for one slot: active technicians plus whoever the pair already lists (kept visible). */
  const optionsFor = (slot: number) => {
    const current = v.userIds[slot]
    if (!current || technicians.some((u) => u.id === current)) return technicians
    const extra = users.find((u) => u.id === current)
    return extra ? [...technicians, extra] : technicians
  }

  return (
    <div className="card">
      <div className="card-head">
        <h2>{t('pairs.title')}</h2>
        {canEdit ? (
          <div className="actions">
            <button
              type="button"
              className="btn btn-primary btn-small"
              disabled={editing === 'new'}
              onClick={() => open('new')}
            >
              {t('pairs.new')}
            </button>
          </div>
        ) : null}
      </div>
      <p className="muted small">{t('pairs.hint')}</p>
      <ErrorBox error={error} />
      {pairs.length === 0 ? (
        <Empty text={t('pairs.noPairs')} />
      ) : (
        <div className="table-wrap">
          <table className="table compact">
            <thead>
              <tr>
                <th>{t('pairs.name')}</th>
                <th>{t('pairs.technicians')}</th>
                <th>{t('pairs.vehicle')}</th>
                <th>{t('pairs.defaultZone')}</th>
                <th>{t('users.status')}</th>
                {canEdit ? <th /> : null}
              </tr>
            </thead>
            <tbody>
              {pairs.map((p) => (
                <tr key={p.id} className={editingPair?.id === p.id ? 'row-picked' : undefined}>
                  <td>{p.name}</td>
                  <td className="small">{p.userNames.join(', ')}</td>
                  <td className="small">{p.vehicle ?? ''}</td>
                  <td className="small">{zoneName(p.defaultZoneId)}</td>
                  <td>
                    {p.active ? (
                      <Badge kind="ok">{t('pairs.active')}</Badge>
                    ) : (
                      <Badge kind="muted">{t('pairs.archived')}</Badge>
                    )}
                  </td>
                  {canEdit ? (
                    <td className="actions nowrap">
                      <button type="button" className="btn btn-small" onClick={() => open(p)}>
                        {t('common.edit')}
                      </button>
                      {p.active ? (
                        <ConfirmButton
                          className="btn btn-small btn-danger-outline"
                          label={t('common.archive')}
                          onConfirm={() => archive(p)}
                        />
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!canEdit ? <p className="muted small">{t('settings.readOnly')}</p> : null}
      {editing && canEdit ? (
        <form
          className="inline-form pair-form"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <h3>{editing === 'new' ? t('pairs.new') : t('pairs.edit', { name: editing.name })}</h3>
          <div className="row">
            <Field label={t('pairs.name')} required error={err.name}>
              <input value={v.name} onChange={(e) => form.set('name', e.target.value)} />
            </Field>
            <Field label={t('pairs.vehicle')} error={err.vehicle}>
              <input value={v.vehicle} onChange={(e) => form.set('vehicle', e.target.value)} />
            </Field>
          </div>
          <div className="field">
            <span className="field-label">
              {t('pairs.technicians')}
              <span className="req"> *</span>
            </span>
            <div className="row pair-slots">
              {v.userIds.map((id, slot) => (
                <select
                  key={slot}
                  value={id}
                  onChange={(e) => {
                    const next: [string, string, string] = [...v.userIds]
                    next[slot] = e.target.value
                    form.set('userIds', next)
                  }}
                >
                  <option value="">{slot === 0 ? t('pairs.pickTechnician') : '—'}</option>
                  {optionsFor(slot).map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              ))}
            </div>
            {localError || err.userIds ? (
              <span className="field-error">{localError ?? err.userIds}</span>
            ) : (
              <span className="field-hint">{t('pairs.techniciansHint')}</span>
            )}
          </div>
          <Field
            label={t('pairs.defaultZone')}
            error={err.defaultZoneId}
            hint={t('pairs.defaultZoneHint')}
          >
            <select
              value={v.defaultZoneId}
              onChange={(e) => form.set('defaultZoneId', e.target.value)}
            >
              <option value="">{t('pairs.noDefaultZone')}</option>
              {activeZones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </select>
          </Field>
          <ErrorBox error={form.error} />
          <div className="actions">
            <button type="submit" className="btn btn-primary" disabled={form.busy}>
              {t('common.save')}
            </button>
            <button type="button" className="btn" onClick={close}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  )
}
