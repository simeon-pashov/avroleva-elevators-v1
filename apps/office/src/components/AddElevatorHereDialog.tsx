import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type {
  BuildingWithElevatorResultDto,
  CustomerDto,
  DoorType,
  DriveType,
  GeoSuggestionDto,
  NearbyBuildingDto,
  Page,
} from '@avroleva/contracts'
import { DoorType as DoorTypeEnum, DriveType as DriveTypeEnum } from '@avroleva/contracts'
import { ApiError, get, post, qs } from '../lib/api'
import { useI18n } from '../i18n/I18nProvider'
import { ErrorBox, Field, toast } from './ui'
import { EnumSelect } from './EnumSelect'

interface AddressDraft {
  city: string
  postcode: string
  district: string
  street: string
  number: string
  block: string
  entrance: string
}

/**
 * "Добави асансьор тук": from a dropped (draggable) pin. Prefills the address parts from the
 * search result, lists existing buildings within ~60 m so a second entrance attaches instead of
 * duplicating, asks for entrance / internal number / stops / type / customer (existing or new)
 * and creates building + elevator in one call. The pin stays draggable until saved: `point`
 * follows the marker.
 */
export function AddElevatorHereDialog({
  point,
  suggestion,
  onClose,
  onCreated,
}: {
  point: { lat: number; lng: number }
  suggestion: GeoSuggestionDto | null
  onClose: () => void
  onCreated: (r: BuildingWithElevatorResultDto) => void
}) {
  const { t } = useI18n()
  const a = suggestion?.address
  const [addr, setAddr] = useState<AddressDraft>({
    city: a?.city || 'София',
    postcode: a?.postcode ?? '',
    district: a?.district ?? '',
    street: a?.street ?? '',
    number: a?.number ?? '',
    block: a?.block ?? '',
    entrance: a?.entrance ?? '',
  })
  const [nearby, setNearby] = useState<NearbyBuildingDto[]>([])
  const [attachTo, setAttachTo] = useState<string>('')
  const [customers, setCustomers] = useState<CustomerDto[]>([])
  const [customerId, setCustomerId] = useState('')
  const [newCustomer, setNewCustomer] = useState('')
  const [internalNo, setInternalNo] = useState('')
  const [stops, setStops] = useState('8')
  const [driveType, setDriveType] = useState<DriveType>('electric')
  const [doorType, setDoorType] = useState<DoorType>('manual')
  const [regNo, setRegNo] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    get<Page<CustomerDto>>(`/customers${qs({ limit: 200 })}`)
      .then((p) => setCustomers(p.items))
      .catch(() => undefined)
  }, [])
  useEffect(() => {
    let cancelled = false
    get<{ items: NearbyBuildingDto[] }>(
      `/buildings/nearby${qs({ lat: point.lat, lng: point.lng, radiusM: 60 })}`,
    )
      .then((r) => !cancelled && setNearby(r.items))
      .catch(() => !cancelled && setNearby([]))
    return () => {
      cancelled = true
    }
  }, [point.lat, point.lng])
  useEffect(() => {
    if (addr.entrance && !internalNo)
      setInternalNo(`${t('address.entranceShort')} ${addr.entrance}`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addr.entrance])

  const set = (k: keyof AddressDraft, v: string) => setAddr((s) => ({ ...s, [k]: v }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setErrors({})
    try {
      const elevator = {
        internalNo: internalNo.trim(),
        stops: Number(stops),
        driveType,
        doorType,
        regNo: regNo.trim() || null,
      }
      const body = attachTo
        ? { buildingId: attachTo, elevator }
        : {
            building: {
              address: {
                city: addr.city,
                postcode: addr.postcode,
                district: addr.district,
                street: addr.street,
                number: addr.number,
                block: addr.block,
                entrance: addr.entrance,
              },
              lat: point.lat,
              lng: point.lng,
            },
            ...(newCustomer.trim()
              ? { newCustomer: { name: newCustomer.trim(), kind: 'etazhna_sobstvenost' } }
              : customerId
                ? { customerId }
                : {}),
            elevator,
          }
      const r = await post<BuildingWithElevatorResultDto>('/buildings/with-elevator', body)
      toast(t('geo.created'))
      onCreated(r)
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) setErrors(err.fieldErrors)
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="drawer-root">
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={t('geo.addHere')}>
        <div className="drawer-head">
          <h2>{t('geo.addHere')}</h2>
          <button type="button" className="btn btn-small drawer-close" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
        <form onSubmit={submit} className="add-here-form">
          <p className="muted small">
            {t('geo.pinHint')} {suggestion?.approximate ? t('geo.blockCentreHint') : ''}
            <br />
            <span className="coords">
              {point.lat.toFixed(6)}, {point.lng.toFixed(6)}
            </span>
          </p>
          {nearby.length > 0 ? (
            <div className="alert nearby-box">
              <strong>{t('geo.nearbyTitle', { count: nearby.length })}</strong>
              <div className="small muted">{t('geo.nearbyHint')}</div>
              <label className="check">
                <input
                  type="radio"
                  name="attach"
                  checked={attachTo === ''}
                  onChange={() => setAttachTo('')}
                />
                <span>{t('geo.createNew')}</span>
              </label>
              {nearby.map((b) => (
                <label key={b.id} className="check">
                  <input
                    type="radio"
                    name="attach"
                    checked={attachTo === b.id}
                    onChange={() => setAttachTo(b.id)}
                  />
                  <span>
                    {b.addressText}
                    <span className="muted small">
                      {' '}
                      · {t('geo.metres', { count: b.distanceM })} ·{' '}
                      {t('buildings.elevatorsCount', { count: b.elevatorCount })}
                      {b.customerName ? ` · ${b.customerName}` : ''}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          ) : null}
          {!attachTo ? (
            <>
              <h3 className="sub-head">{t('buildings.address')}</h3>
              <div className="row">
                <Field label={t('address.city')} required error={errors['building.address.city']}>
                  <input value={addr.city} onChange={(e) => set('city', e.target.value)} required />
                </Field>
                <Field label={t('address.postcode')}>
                  <input value={addr.postcode} onChange={(e) => set('postcode', e.target.value)} />
                </Field>
              </div>
              <Field label={t('address.district')} hint={t('address.districtHint')}>
                <input value={addr.district} onChange={(e) => set('district', e.target.value)} />
              </Field>
              <div className="row">
                <Field label={t('address.street')}>
                  <input value={addr.street} onChange={(e) => set('street', e.target.value)} />
                </Field>
                <Field label={t('address.number')}>
                  <input value={addr.number} onChange={(e) => set('number', e.target.value)} />
                </Field>
              </div>
              <div className="row">
                <Field label={t('address.block')}>
                  <input value={addr.block} onChange={(e) => set('block', e.target.value)} />
                </Field>
                <Field label={t('address.entrance')}>
                  <input value={addr.entrance} onChange={(e) => set('entrance', e.target.value)} />
                </Field>
              </div>
              <h3 className="sub-head">{t('buildings.customer')}</h3>
              <Field label={t('geo.existingCustomer')}>
                <select
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                  disabled={!!newCustomer.trim()}
                >
                  <option value="">{t('common.none')}</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('geo.newCustomer')} hint={t('geo.newCustomerHint')}>
                <input value={newCustomer} onChange={(e) => setNewCustomer(e.target.value)} />
              </Field>
            </>
          ) : null}
          <h3 className="sub-head">{t('elevators.one')}</h3>
          <div className="row">
            <Field label={t('elevators.internalNo')} required error={errors['elevator.internalNo']}>
              <input value={internalNo} onChange={(e) => setInternalNo(e.target.value)} required />
            </Field>
            <Field label={t('elevators.stops')} required error={errors['elevator.stops']}>
              <input
                type="number"
                min={2}
                max={60}
                value={stops}
                onChange={(e) => setStops(e.target.value)}
                required
              />
            </Field>
          </div>
          <div className="row">
            <Field label={t('elevators.driveType')}>
              <EnumSelect
                value={driveType}
                options={DriveTypeEnum.options}
                prefix="enum.driveType"
                onChange={(v) => v && setDriveType(v)}
              />
            </Field>
            <Field label={t('elevators.doorType')}>
              <EnumSelect
                value={doorType}
                options={DoorTypeEnum.options}
                prefix="enum.doorType"
                onChange={(v) => v && setDoorType(v)}
              />
            </Field>
          </div>
          <Field label={t('elevators.regNo')} error={errors['elevator.regNo']}>
            <input value={regNo} onChange={(e) => setRegNo(e.target.value)} />
          </Field>
          <ErrorBox error={error} />
          <div className="actions drawer-actions">
            <button type="submit" className="btn btn-primary" disabled={busy || !internalNo.trim()}>
              {attachTo ? t('geo.attachAndCreate') : t('geo.createBoth')}
            </button>
            <button type="button" className="btn" onClick={onClose} disabled={busy}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      </aside>
    </div>
  )
}
