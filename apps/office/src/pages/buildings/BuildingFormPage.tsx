import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import type { BuildingDto, CustomerDto, Page } from '@avroleva/contracts'
import { get, patch, post, qs } from '../../lib/api'
import { useI18n } from '../../i18n/I18nProvider'
import { ErrorBox, Field, PageHeader, Spinner, toast } from '../../components/ui'
import { MapPicker } from '../../components/MapPicker'
import { useForm } from '../../components/useForm'

interface FormValues {
  customerId: string
  city: string
  postcode: string
  oblast: string
  district: string
  street: string
  number: string
  block: string
  entrance: string
  lat: number | null
  lng: number | null
  accessNotes: string
  keysLocation: string
  notes: string
}

const empty: FormValues = {
  customerId: '',
  city: 'София',
  postcode: '',
  oblast: 'София-град',
  district: '',
  street: '',
  number: '',
  block: '',
  entrance: '',
  lat: null,
  lng: null,
  accessNotes: '',
  keysLocation: '',
  notes: '',
}

export function BuildingFormPage() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const { t } = useI18n()
  const navigate = useNavigate()
  const form = useForm<FormValues>({ ...empty, customerId: params.get('customerId') ?? '' })
  const [customers, setCustomers] = useState<CustomerDto[]>([])
  const [loaded, setLoaded] = useState(!id)
  const [loadError, setLoadError] = useState<unknown>(null)

  useEffect(() => {
    get<Page<CustomerDto>>(`/customers${qs({ limit: 200 })}`)
      .then((p) => setCustomers(p.items))
      .catch(setLoadError)
  }, [])

  useEffect(() => {
    if (!id) return
    get<BuildingDto>(`/buildings/${id}`)
      .then((b) => {
        form.setValues({
          customerId: b.customerId ?? '',
          city: b.address.city,
          postcode: b.address.postcode ?? '',
          oblast: b.address.oblast ?? '',
          district: b.address.district ?? '',
          street: b.address.street ?? '',
          number: b.address.number ?? '',
          block: b.address.block ?? '',
          entrance: b.address.entrance ?? '',
          lat: b.lat,
          lng: b.lng,
          accessNotes: b.accessNotes ?? '',
          keysLocation: b.keysLocation ?? '',
          notes: b.notes ?? '',
        })
        setLoaded(true)
      })
      .catch(setLoadError)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  if (loadError) return <ErrorBox error={loadError} />
  if (!loaded) return <Spinner />
  const v = form.values
  const err = form.errors

  const save = () =>
    form.submit(async (values) => {
      const body = {
        customerId: values.customerId || null,
        address: {
          city: values.city,
          postcode: values.postcode,
          oblast: values.oblast,
          district: values.district,
          street: values.street,
          number: values.number,
          block: values.block,
          entrance: values.entrance,
        },
        lat: values.lat,
        lng: values.lng,
        accessNotes: values.accessNotes,
        keysLocation: values.keysLocation,
        notes: values.notes,
      }
      const saved = id
        ? await patch<BuildingDto>(`/buildings/${id}`, body)
        : await post<BuildingDto>('/buildings', body)
      toast(t('common.saved'))
      navigate(`/buildings/${saved.id}`)
    })

  return (
    <div>
      <PageHeader
        back={
          <Link to={id ? `/buildings/${id}` : '/buildings'} className="back">
            {t('buildings.title')}
          </Link>
        }
        title={id ? t('buildings.edit') : t('buildings.new')}
      />
      <form
        className="grid-2"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <div className="card">
          <h2>{t('buildings.address')}</h2>
          <Field label={t('buildings.customer')} error={err.customerId}>
            <select value={v.customerId} onChange={(e) => form.set('customerId', e.target.value)}>
              <option value="">{t('common.none')}</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="row">
            <Field label={t('address.city')} required error={err['address.city']}>
              <input value={v.city} onChange={(e) => form.set('city', e.target.value)} />
            </Field>
            <Field label={t('address.postcode')} error={err['address.postcode']}>
              <input value={v.postcode} onChange={(e) => form.set('postcode', e.target.value)} />
            </Field>
          </div>
          <Field label={t('address.oblast')} error={err['address.oblast']}>
            <input value={v.oblast} onChange={(e) => form.set('oblast', e.target.value)} />
          </Field>
          <Field
            label={t('address.district')}
            error={err['address.district']}
            hint={t('address.districtHint')}
          >
            <input value={v.district} onChange={(e) => form.set('district', e.target.value)} />
          </Field>
          <div className="row">
            <Field label={t('address.street')} error={err['address.street']}>
              <input value={v.street} onChange={(e) => form.set('street', e.target.value)} />
            </Field>
            <Field label={t('address.number')} error={err['address.number']}>
              <input value={v.number} onChange={(e) => form.set('number', e.target.value)} />
            </Field>
          </div>
          <div className="row">
            <Field label={t('address.block')} error={err['address.block']}>
              <input value={v.block} onChange={(e) => form.set('block', e.target.value)} />
            </Field>
            <Field label={t('address.entrance')} error={err['address.entrance']}>
              <input value={v.entrance} onChange={(e) => form.set('entrance', e.target.value)} />
            </Field>
          </div>
          <Field label={t('buildings.accessNotes')} error={err.accessNotes}>
            <textarea
              rows={3}
              value={v.accessNotes}
              onChange={(e) => form.set('accessNotes', e.target.value)}
            />
          </Field>
          <Field label={t('buildings.keysLocation')} error={err.keysLocation}>
            <input
              value={v.keysLocation}
              onChange={(e) => form.set('keysLocation', e.target.value)}
            />
          </Field>
          <Field label={t('common.notes')} error={err.notes}>
            <textarea
              rows={3}
              value={v.notes}
              onChange={(e) => form.set('notes', e.target.value)}
            />
          </Field>
        </div>
        <div className="card">
          <h2>{t('buildings.location')}</h2>
          <MapPicker
            lat={v.lat}
            lng={v.lng}
            onChange={(lat, lng) => form.setValues((s) => ({ ...s, lat, lng }))}
          />
          <div className="row">
            <Field label={t('buildings.lat')} error={err.lat}>
              <input
                type="number"
                step="0.000001"
                value={v.lat ?? ''}
                onChange={(e) =>
                  form.set('lat', e.target.value === '' ? null : Number(e.target.value))
                }
              />
            </Field>
            <Field label={t('buildings.lng')} error={err.lng}>
              <input
                type="number"
                step="0.000001"
                value={v.lng ?? ''}
                onChange={(e) =>
                  form.set('lng', e.target.value === '' ? null : Number(e.target.value))
                }
              />
            </Field>
          </div>
          <p className="muted small">{t('buildings.geocodeLater')}</p>
          <ErrorBox error={form.error} />
          <div className="actions">
            <button type="submit" className="btn btn-primary" disabled={form.busy}>
              {t('common.save')}
            </button>
            <Link className="btn" to={id ? `/buildings/${id}` : '/buildings'}>
              {t('common.cancel')}
            </Link>
          </div>
        </div>
      </form>
    </div>
  )
}
