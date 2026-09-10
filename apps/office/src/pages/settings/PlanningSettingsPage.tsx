import { useCallback, useEffect, useState } from 'react'
import type {
  BuildingPinDto,
  TechnicianPairDto,
  TenantDto,
  UserDto,
  ZoneDto,
} from '@avroleva/contracts'
import { get, patch } from '../../lib/api'
import { useI18n } from '../../i18n/I18nProvider'
import { useAuth } from '../../auth/AuthProvider'
import { ErrorBox, Field, PageHeader, Spinner, toast } from '../../components/ui'
import { numOrNull, useForm } from '../../components/useForm'
import { SettingsNav } from '../../components/SettingsNav'
import { MapPicker } from '../../components/MapPicker'
import { AddressSearch } from '../../components/AddressSearch'
import { ZonesEditor } from '../../components/planning/ZonesEditor'
import { PairsEditor } from '../../components/planning/PairsEditor'

interface FormValues {
  baseAddress: string
  baseLat: string
  baseLng: string
  avgStopMinutes: string
  avgSpeedKmh: string
  dayStart: string
}

const fmt = (n: number | null | undefined) => (n == null ? '' : String(n))

/**
 * Settings -> Планиране: the base the routes start from and the ETA defaults (owner saves),
 * the zones (owner/office) and the technician pairs (owner).
 */
export function PlanningSettingsPage() {
  const { t } = useI18n()
  const { hasRole, refresh } = useAuth()
  const isOwner = hasRole('owner')
  const isOffice = hasRole('owner', 'office')
  const [tenant, setTenant] = useState<TenantDto | null>(null)
  const [zones, setZones] = useState<ZoneDto[] | null>(null)
  const [pairs, setPairs] = useState<TechnicianPairDto[] | null>(null)
  const [users, setUsers] = useState<UserDto[]>([])
  const [pins, setPins] = useState<BuildingPinDto[]>([])
  const [loadError, setLoadError] = useState<unknown>(null)
  const form = useForm<FormValues>({
    baseAddress: '',
    baseLat: '',
    baseLng: '',
    avgStopMinutes: '25',
    avgSpeedKmh: '25',
    dayStart: '08:30',
  })

  const loadZones = useCallback(
    () => get<{ items: ZoneDto[] }>('/zones').then((r) => setZones(r.items)),
    [],
  )
  const loadPairs = useCallback(
    () => get<{ items: TechnicianPairDto[] }>('/technician-pairs').then((r) => setPairs(r.items)),
    [],
  )

  useEffect(() => {
    Promise.all([
      get<TenantDto>('/tenant'),
      loadZones(),
      loadPairs(),
      get<{ items: UserDto[] }>('/users'),
      get<{ items: BuildingPinDto[] }>('/buildings/pins'),
    ])
      .then(([tn, , , u, p]) => {
        setTenant(tn)
        setUsers(u.items)
        setPins(p.items)
        const pl = tn.settings.planning
        form.setValues({
          baseAddress: pl.baseAddress,
          baseLat: fmt(pl.baseLat),
          baseLng: fmt(pl.baseLng),
          avgStopMinutes: String(pl.avgStopMinutes),
          avgSpeedKmh: String(pl.avgSpeedKmh),
          dayStart: pl.dayStart,
        })
      })
      .catch(setLoadError)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (loadError) return <ErrorBox error={loadError} />
  if (!tenant || !zones || !pairs) return <Spinner />
  const v = form.values
  const err = form.errors
  const ro = !isOwner
  const lat = numOrNull(v.baseLat)
  const lng = numOrNull(v.baseLng)

  const place = (la: number, ln: number) => {
    form.set('baseLat', String(la))
    form.set('baseLng', String(ln))
  }

  const save = () =>
    form.submit(async (values) => {
      const planning = {
        baseAddress: values.baseAddress.trim(),
        baseLat: numOrNull(values.baseLat),
        baseLng: numOrNull(values.baseLng),
        avgStopMinutes: Number(values.avgStopMinutes),
        avgSpeedKmh: Number(values.avgSpeedKmh),
        dayStart: values.dayStart,
      }
      setTenant(await patch<TenantDto>('/tenant', { settings: { planning } }))
      toast(t('common.saved'))
      await refresh()
    })

  return (
    <div>
      <PageHeader title={t('settings.planning.title')} subtitle={t('settings.planning.hint')} />
      <SettingsNav />
      <form
        className="card plan-settings-base"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <h2>{t('settings.planning.base')}</h2>
        <p className="muted small">{t('settings.planning.baseHint')}</p>
        <div className="grid-2 plan-settings-grid">
          <div>
            {!ro ? (
              <div className="field">
                <span className="field-label">{t('geo.search')}</span>
                <AddressSearch
                  bias={lat != null && lng != null ? { lat, lng } : null}
                  onPick={(s) => {
                    form.set('baseAddress', s.label)
                    place(s.lat, s.lng)
                  }}
                />
              </div>
            ) : null}
            <Field
              label={t('settings.planning.baseAddress')}
              error={err['settings.planning.baseAddress']}
            >
              <input
                value={v.baseAddress}
                readOnly={ro}
                onChange={(e) => form.set('baseAddress', e.target.value)}
              />
            </Field>
            <div className="row">
              <Field
                label={t('settings.planning.baseLat')}
                error={err['settings.planning.baseLat']}
              >
                <input
                  type="number"
                  step="0.000001"
                  min={-90}
                  max={90}
                  value={v.baseLat}
                  readOnly={ro}
                  onChange={(e) => form.set('baseLat', e.target.value)}
                />
              </Field>
              <Field
                label={t('settings.planning.baseLng')}
                error={err['settings.planning.baseLng']}
              >
                <input
                  type="number"
                  step="0.000001"
                  min={-180}
                  max={180}
                  value={v.baseLng}
                  readOnly={ro}
                  onChange={(e) => form.set('baseLng', e.target.value)}
                />
              </Field>
            </div>
            <div className="row">
              <Field
                label={t('settings.planning.avgStopMinutes')}
                error={err['settings.planning.avgStopMinutes']}
              >
                <input
                  type="number"
                  min={5}
                  max={240}
                  value={v.avgStopMinutes}
                  readOnly={ro}
                  onChange={(e) => form.set('avgStopMinutes', e.target.value)}
                />
              </Field>
              <Field
                label={t('settings.planning.avgSpeedKmh')}
                error={err['settings.planning.avgSpeedKmh']}
              >
                <input
                  type="number"
                  min={5}
                  max={120}
                  value={v.avgSpeedKmh}
                  readOnly={ro}
                  onChange={(e) => form.set('avgSpeedKmh', e.target.value)}
                />
              </Field>
              <Field
                label={t('settings.planning.dayStart')}
                error={err['settings.planning.dayStart']}
              >
                <input
                  type="time"
                  value={v.dayStart}
                  readOnly={ro}
                  onChange={(e) => form.set('dayStart', e.target.value)}
                />
              </Field>
            </div>
          </div>
          <MapPicker lat={lat} lng={lng} onChange={ro ? undefined : place} height={300} />
        </div>
        <ErrorBox error={form.error} />
        {isOwner ? (
          <div className="actions">
            <button type="submit" className="btn btn-primary" disabled={form.busy}>
              {t('common.save')}
            </button>
          </div>
        ) : (
          <p className="muted small">{t('settings.readOnly')}</p>
        )}
      </form>
      <ZonesEditor zones={zones} pins={pins} canEdit={isOffice} onChanged={loadZones} />
      <PairsEditor
        pairs={pairs}
        zones={zones}
        users={users}
        canEdit={isOwner}
        onChanged={loadPairs}
      />
    </div>
  )
}
