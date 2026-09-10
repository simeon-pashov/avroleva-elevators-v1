import { useState } from 'react'
import type { BuildingPinDto, ZoneDto, ZoneRecomputeResultDto } from '@avroleva/contracts'
import { del, patch, post } from '../../lib/api'
import { useI18n } from '../../i18n/I18nProvider'
import { Badge, ConfirmButton, Empty, ErrorBox, Field, toast } from '../../components/ui'
import { useForm } from '../../components/useForm'
import { polygonToVertices, verticesToPolygon, ZoneMapEditor } from './ZoneMapEditor'
import type { Vertex } from './ZoneMapEditor'

interface ZoneForm {
  name: string
  colour: string
  /** Comma-separated district names. */
  districts: string
  vertices: Vertex[]
}

const EMPTY: ZoneForm = { name: '', colour: '#2563eb', districts: '', vertices: [] }

const splitDistricts = (s: string) =>
  s
    .split(',')
    .map((d) => d.trim())
    .filter(Boolean)

/** Settings -> Планиране -> Райони: the zone table, the inline create/edit form and recompute. */
export function ZonesEditor({
  zones,
  pins,
  canEdit,
  onChanged,
}: {
  zones: ZoneDto[]
  pins: BuildingPinDto[]
  canEdit: boolean
  onChanged: () => Promise<void>
}) {
  const { t, number } = useI18n()
  // 'new' = the create form; a ZoneDto = editing that zone; null = table only.
  const [editing, setEditing] = useState<ZoneDto | 'new' | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [recomputing, setRecomputing] = useState(false)
  const form = useForm<ZoneForm>(EMPTY)

  const open = (target: ZoneDto | 'new') => {
    setError(null)
    form.setValues(
      target === 'new'
        ? EMPTY
        : {
            name: target.name,
            colour: target.colour,
            districts: target.districts.join(', '),
            vertices: polygonToVertices(target.polygon),
          },
    )
    setEditing(target)
  }
  const close = () => setEditing(null)

  const save = () =>
    form.submit(async (v) => {
      if (editing === 'new') {
        await post('/zones', {
          name: v.name,
          colour: v.colour,
          districts: splitDistricts(v.districts),
          polygon: verticesToPolygon(v.vertices),
        })
      } else if (editing) {
        await patch(`/zones/${editing.id}`, {
          name: v.name,
          colour: v.colour,
          ...(editing.isDefault
            ? {}
            : {
                districts: splitDistricts(v.districts),
                polygon: verticesToPolygon(v.vertices),
              }),
        })
      }
      toast(t('common.saved'))
      close()
      await onChanged()
    })

  const archive = async (z: ZoneDto) => {
    try {
      await del(`/zones/${z.id}`)
      toast(t('common.archived'))
      if (editing !== 'new' && editing?.id === z.id) close()
      await onChanged()
    } catch (e) {
      setError(e)
    }
  }

  const recompute = async () => {
    setRecomputing(true)
    setError(null)
    try {
      const r = await post<ZoneRecomputeResultDto>('/zones/recompute')
      toast(t('zones.recomputed', { changed: r.changed, total: r.total }))
      await onChanged()
    } catch (e) {
      setError(e)
    } finally {
      setRecomputing(false)
    }
  }

  const editingZone = editing && editing !== 'new' ? editing : null
  const isDefault = editingZone?.isDefault ?? false
  const others = zones.filter((z) => z.active && z.id !== editingZone?.id)
  const v = form.values
  const err = form.errors

  return (
    <div className="card">
      <div className="card-head">
        <h2>{t('zones.title')}</h2>
        {canEdit ? (
          <div className="actions">
            <button
              type="button"
              className="btn btn-small"
              disabled={recomputing}
              onClick={() => void recompute()}
            >
              {t('zones.recompute')}
            </button>
            <button
              type="button"
              className="btn btn-primary btn-small"
              disabled={editing === 'new'}
              onClick={() => open('new')}
            >
              {t('zones.new')}
            </button>
          </div>
        ) : null}
      </div>
      <p className="muted small">{t('zones.hint')}</p>
      <ErrorBox error={error} />
      {zones.length === 0 ? (
        <Empty text={t('zones.noZones')} />
      ) : (
        <div className="table-wrap">
          <table className="table compact">
            <thead>
              <tr>
                <th className="zone-swatch-col" />
                <th>{t('zones.name')}</th>
                <th>{t('zones.districts')}</th>
                <th className="num">{t('zones.buildings')}</th>
                <th>{t('users.status')}</th>
                {canEdit ? <th /> : null}
              </tr>
            </thead>
            <tbody>
              {zones.map((z) => (
                <tr key={z.id} className={editingZone?.id === z.id ? 'row-picked' : undefined}>
                  <td>
                    <span className="zone-swatch" style={{ background: z.colour }} />
                  </td>
                  <td>
                    {z.name} {z.isDefault ? <Badge kind="info">{t('zones.default')}</Badge> : null}
                  </td>
                  <td className="small">{z.districts.join(', ')}</td>
                  <td className="num">{number(z.buildingCount)}</td>
                  <td>
                    {z.active ? (
                      <Badge kind="ok">{t('zones.active')}</Badge>
                    ) : (
                      <Badge kind="muted">{t('zones.archived')}</Badge>
                    )}
                  </td>
                  {canEdit ? (
                    <td className="actions nowrap">
                      <button type="button" className="btn btn-small" onClick={() => open(z)}>
                        {t('common.edit')}
                      </button>
                      {!z.isDefault && z.active ? (
                        <ConfirmButton
                          className="btn btn-small btn-danger-outline"
                          label={t('common.archive')}
                          onConfirm={() => archive(z)}
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
          className="inline-form zone-form"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <h3>{editing === 'new' ? t('zones.new') : t('zones.edit', { name: editing.name })}</h3>
          <div className="row">
            <Field label={t('zones.name')} required error={err.name}>
              <input value={v.name} onChange={(e) => form.set('name', e.target.value)} />
            </Field>
            <Field label={t('zones.colour')} error={err.colour}>
              <input
                type="color"
                className="zone-colour"
                value={v.colour}
                onChange={(e) => form.set('colour', e.target.value)}
              />
            </Field>
          </div>
          {isDefault ? (
            <p className="muted small">{t('zones.defaultHint')}</p>
          ) : (
            <>
              <Field
                label={t('zones.districts')}
                error={err.districts}
                hint={t('zones.districtsHint')}
              >
                <input
                  value={v.districts}
                  onChange={(e) => form.set('districts', e.target.value)}
                />
              </Field>
              <div className="field">
                <span className="field-label">{t('zones.polygon')}</span>
                <ZoneMapEditor
                  others={others}
                  pins={pins}
                  vertices={v.vertices}
                  onChange={(verts) => form.set('vertices', verts)}
                  editable
                />
                {err.polygon ? <span className="field-error">{err.polygon}</span> : null}
              </div>
            </>
          )}
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
