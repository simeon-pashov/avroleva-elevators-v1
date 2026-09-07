import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import type {
  BuildingDto,
  DoorType,
  DriveType,
  ElevatorDto,
  ElevatorStatus,
  Page,
} from '@avroleva/contracts'
import {
  DoorType as DoorTypeEnum,
  DriveType as DriveTypeEnum,
  ElevatorStatus as ElevatorStatusEnum,
} from '@avroleva/contracts'
import { get, patch, post, qs } from '../../lib/api'
import { useI18n } from '../../i18n/I18nProvider'
import { useAuth } from '../../auth/AuthProvider'
import { ErrorBox, Field, PageHeader, Spinner, toast } from '../../components/ui'
import { EnumSelect } from '../../components/EnumSelect'
import { useForm } from '../../components/useForm'

interface FormValues {
  buildingId: string
  internalNo: string
  regNo: string
  inspectionBody: string
  manufacturer: string
  year: string
  driveType: DriveType
  doorType: DoorType
  stops: string
  loadKg: string
  status: ElevatorStatus
  checkIntervalDays: string
  lastCheckAt: string
  nextInspectionAt: string
  alarmDevicePhone: string
  alarmSimOperator: string
  notes: string
}

export function ElevatorFormPage() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const { t } = useI18n()
  const { me } = useAuth()
  const navigate = useNavigate()
  const form = useForm<FormValues>({
    buildingId: params.get('buildingId') ?? '',
    internalNo: '',
    regNo: '',
    inspectionBody: '',
    manufacturer: '',
    year: '',
    driveType: 'electric',
    doorType: 'manual',
    stops: '',
    loadKg: '',
    status: 'active',
    checkIntervalDays: '',
    lastCheckAt: '',
    nextInspectionAt: '',
    alarmDevicePhone: '',
    alarmSimOperator: '',
    notes: '',
  })
  const [buildings, setBuildings] = useState<BuildingDto[]>([])
  const [loaded, setLoaded] = useState(!id)
  const [loadError, setLoadError] = useState<unknown>(null)

  useEffect(() => {
    get<Page<BuildingDto>>(`/buildings${qs({ limit: 200 })}`)
      .then((p) => setBuildings(p.items))
      .catch(setLoadError)
  }, [])

  useEffect(() => {
    if (!id) return
    get<ElevatorDto>(`/elevators/${id}`)
      .then((e) => {
        form.setValues({
          buildingId: e.buildingId,
          internalNo: e.internalNo,
          regNo: e.regNo ?? '',
          inspectionBody: e.inspectionBody ?? '',
          manufacturer: e.manufacturer ?? '',
          year: e.year?.toString() ?? '',
          driveType: e.driveType,
          doorType: e.doorType,
          stops: String(e.stops),
          loadKg: e.loadKg?.toString() ?? '',
          status: e.status,
          checkIntervalDays: e.checkIntervalDays?.toString() ?? '',
          lastCheckAt: e.lastCheckAt ?? '',
          nextInspectionAt: e.nextInspectionAt ?? '',
          alarmDevicePhone: e.alarmDevicePhone ?? '',
          alarmSimOperator: e.alarmSimOperator ?? '',
          notes: e.notes ?? '',
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
  const num = (s: string) => (s.trim() === '' ? null : Number(s))

  const save = () =>
    form.submit(async (values) => {
      const body = {
        buildingId: values.buildingId,
        internalNo: values.internalNo,
        regNo: values.regNo,
        inspectionBody: values.inspectionBody,
        manufacturer: values.manufacturer,
        year: num(values.year),
        driveType: values.driveType,
        doorType: values.doorType,
        stops: num(values.stops),
        loadKg: num(values.loadKg),
        status: values.status,
        checkIntervalDays: num(values.checkIntervalDays),
        lastCheckAt: values.lastCheckAt || null,
        nextInspectionAt: values.nextInspectionAt || null,
        alarmDevicePhone: values.alarmDevicePhone,
        alarmSimOperator: values.alarmSimOperator,
        notes: values.notes,
      }
      const saved = id
        ? await patch<ElevatorDto>(`/elevators/${id}`, body)
        : await post<ElevatorDto>('/elevators', body)
      toast(t('common.saved'))
      navigate(`/elevators/${saved.id}`)
    })

  return (
    <div>
      <PageHeader
        back={
          <Link to={id ? `/elevators/${id}` : '/elevators'} className="back">
            {t('elevators.title')}
          </Link>
        }
        title={id ? t('elevators.edit') : t('elevators.new')}
      />
      <form
        className="grid-2"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <div className="card">
          <h2>{t('elevators.identity')}</h2>
          <Field label={t('elevators.building')} required error={err.buildingId}>
            <select value={v.buildingId} onChange={(e) => form.set('buildingId', e.target.value)}>
              <option value="">{t('common.choose')}</option>
              {buildings.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.addressText}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label={t('elevators.internalNo')}
            required
            error={err.internalNo}
            hint={t('elevators.internalNoHint')}
          >
            <input value={v.internalNo} onChange={(e) => form.set('internalNo', e.target.value)} />
          </Field>
          <div className="row">
            <Field label={t('elevators.regNo')} error={err.regNo}>
              <input value={v.regNo} onChange={(e) => form.set('regNo', e.target.value)} />
            </Field>
            <Field label={t('elevators.inspectionBody')} error={err.inspectionBody}>
              <input
                value={v.inspectionBody}
                onChange={(e) => form.set('inspectionBody', e.target.value)}
              />
            </Field>
          </div>
          <div className="row">
            <Field label={t('elevators.manufacturer')} error={err.manufacturer}>
              <input
                value={v.manufacturer}
                onChange={(e) => form.set('manufacturer', e.target.value)}
              />
            </Field>
            <Field label={t('elevators.year')} error={err.year}>
              <input
                type="number"
                min={1900}
                max={2100}
                value={v.year}
                onChange={(e) => form.set('year', e.target.value)}
              />
            </Field>
          </div>
          <div className="row">
            <Field label={t('elevators.driveType')} error={err.driveType}>
              <EnumSelect
                value={v.driveType}
                options={DriveTypeEnum.options}
                prefix="enum.driveType"
                onChange={(x) => x && form.set('driveType', x)}
              />
            </Field>
            <Field label={t('elevators.doorType')} error={err.doorType}>
              <EnumSelect
                value={v.doorType}
                options={DoorTypeEnum.options}
                prefix="enum.doorType"
                onChange={(x) => x && form.set('doorType', x)}
              />
            </Field>
          </div>
          <div className="row">
            <Field label={t('elevators.stops')} required error={err.stops}>
              <input
                type="number"
                min={2}
                max={60}
                value={v.stops}
                onChange={(e) => form.set('stops', e.target.value)}
              />
            </Field>
            <Field label={t('elevators.loadKg')} error={err.loadKg}>
              <input
                type="number"
                min={50}
                max={10000}
                value={v.loadKg}
                onChange={(e) => form.set('loadKg', e.target.value)}
              />
            </Field>
          </div>
          <Field label={t('elevators.status')} error={err.status}>
            <EnumSelect
              value={v.status}
              options={ElevatorStatusEnum.options}
              prefix="enum.elevatorStatus"
              onChange={(x) => x && form.set('status', x)}
            />
          </Field>
        </div>
        <div className="card">
          <h2>{t('elevators.schedule')}</h2>
          <Field
            label={t('elevators.checkIntervalDays')}
            error={err.checkIntervalDays}
            hint={t('elevators.intervalHint', {
              count: me?.tenant.settings.checkIntervalDays ?? 30,
            })}
          >
            <input
              type="number"
              min={1}
              max={365}
              value={v.checkIntervalDays}
              onChange={(e) => form.set('checkIntervalDays', e.target.value)}
            />
          </Field>
          <div className="row">
            <Field label={t('elevators.lastCheckAt')} error={err.lastCheckAt}>
              <input
                type="date"
                value={v.lastCheckAt}
                onChange={(e) => form.set('lastCheckAt', e.target.value)}
              />
            </Field>
            <Field label={t('elevators.nextInspectionAt')} error={err.nextInspectionAt}>
              <input
                type="date"
                value={v.nextInspectionAt}
                onChange={(e) => form.set('nextInspectionAt', e.target.value)}
              />
            </Field>
          </div>
          <div className="row">
            <Field label={t('elevators.alarmDevicePhone')} error={err.alarmDevicePhone}>
              <input
                value={v.alarmDevicePhone}
                onChange={(e) => form.set('alarmDevicePhone', e.target.value)}
              />
            </Field>
            <Field label={t('elevators.alarmSimOperator')} error={err.alarmSimOperator}>
              <input
                value={v.alarmSimOperator}
                onChange={(e) => form.set('alarmSimOperator', e.target.value)}
              />
            </Field>
          </div>
          <Field label={t('common.notes')} error={err.notes}>
            <textarea
              rows={4}
              value={v.notes}
              onChange={(e) => form.set('notes', e.target.value)}
            />
          </Field>
          <ErrorBox error={form.error} />
          <div className="actions">
            <button type="submit" className="btn btn-primary" disabled={form.busy}>
              {t('common.save')}
            </button>
            <Link className="btn" to={id ? `/elevators/${id}` : '/elevators'}>
              {t('common.cancel')}
            </Link>
          </div>
        </div>
      </form>
    </div>
  )
}
