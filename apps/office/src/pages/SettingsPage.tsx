import { useEffect, useState } from 'react'
import type { TenantDto } from '@avroleva/contracts'
import { get, patch } from '../lib/api'
import { useI18n } from '../i18n/I18nProvider'
import { useAuth } from '../auth/AuthProvider'
import { ErrorBox, Field, PageHeader, Spinner, toast } from '../components/ui'
import { numOrNull, useForm } from '../components/useForm'
import { SettingsNav } from '../components/SettingsNav'

interface FormValues {
  name: string
  eik: string
  vatNo: string
  address: string
  phone: string
  emergencyPhone: string
  email: string
  locale: string
  checkIntervalDays: string
  cycleStrategy: 'rolling' | 'calendar_month'
  callbackSlaMinutes: string
  defectFollowUpDays: string
  currencyDisplay: 'EUR' | 'EUR_BGN'
  inspectionIntervalMonths: string
  firstInspectionIntervalMonths: string
  alarmTestIntervalMonths: string
  retentionYears: string
  publicQrPage: boolean
  publicFaultReport: boolean
  gpsCapture: boolean
  minFunctionalCheck: string
  minTechnicalMaintenance: string
  minRepair: string
  minCallback: string
}

export function SettingsPage() {
  const { t, locales } = useI18n()
  const { hasRole, refresh, changeLocale, me } = useAuth()
  const form = useForm<FormValues>({
    name: '',
    eik: '',
    vatNo: '',
    address: '',
    phone: '',
    emergencyPhone: '',
    email: '',
    locale: 'bg',
    checkIntervalDays: '30',
    cycleStrategy: 'rolling',
    callbackSlaMinutes: '60',
    defectFollowUpDays: '30',
    currencyDisplay: 'EUR',
    inspectionIntervalMonths: '',
    firstInspectionIntervalMonths: '',
    alarmTestIntervalMonths: '',
    retentionYears: '',
    publicQrPage: false,
    publicFaultReport: false,
    gpsCapture: false,
    minFunctionalCheck: '2',
    minTechnicalMaintenance: '2',
    minRepair: '2',
    minCallback: '1',
  })
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<unknown>(null)
  const canEdit = hasRole('owner')

  useEffect(() => {
    get<TenantDto>('/tenant')
      .then((tn) => {
        form.setValues({
          name: tn.name,
          eik: tn.eik,
          vatNo: tn.vatNo ?? '',
          address: tn.address,
          phone: tn.phone,
          emergencyPhone: tn.emergencyPhone,
          email: tn.email ?? '',
          locale: tn.locale,
          checkIntervalDays: String(tn.settings.checkIntervalDays),
          cycleStrategy: tn.settings.cycleStrategy,
          callbackSlaMinutes: String(tn.settings.callbackSlaMinutes),
          defectFollowUpDays: String(tn.settings.defectFollowUpDays),
          currencyDisplay: tn.settings.currencyDisplay,
          inspectionIntervalMonths: tn.settings.inspectionIntervalMonths?.toString() ?? '',
          firstInspectionIntervalMonths:
            tn.settings.firstInspectionIntervalMonths?.toString() ?? '',
          alarmTestIntervalMonths: tn.settings.alarmTestIntervalMonths?.toString() ?? '',
          retentionYears: tn.settings.retentionYears?.toString() ?? '',
          publicQrPage: tn.features.publicQrPage,
          publicFaultReport: tn.features.publicFaultReport,
          gpsCapture: tn.features.gpsCapture,
          minFunctionalCheck: String(tn.settings.minTechnicians.functional_check),
          minTechnicalMaintenance: String(tn.settings.minTechnicians.technical_maintenance),
          minRepair: String(tn.settings.minTechnicians.repair),
          minCallback: String(tn.settings.minTechnicians.callback),
        })
        setLoaded(true)
      })
      .catch(setLoadError)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (loadError) return <ErrorBox error={loadError} />
  if (!loaded) return <Spinner />
  const v = form.values
  const err = form.errors
  const ro = !canEdit

  const save = () =>
    form.submit(async (values) => {
      await patch('/tenant', {
        name: values.name,
        eik: values.eik,
        vatNo: values.vatNo,
        address: values.address,
        phone: values.phone,
        emergencyPhone: values.emergencyPhone,
        email: values.email,
        locale: values.locale,
        settings: {
          checkIntervalDays: Number(values.checkIntervalDays),
          cycleStrategy: values.cycleStrategy,
          callbackSlaMinutes: Number(values.callbackSlaMinutes),
          defectFollowUpDays: Number(values.defectFollowUpDays),
          currencyDisplay: values.currencyDisplay,
          showBgnReference: values.currencyDisplay === 'EUR_BGN',
          inspectionIntervalMonths: numOrNull(values.inspectionIntervalMonths),
          firstInspectionIntervalMonths: numOrNull(values.firstInspectionIntervalMonths),
          alarmTestIntervalMonths: numOrNull(values.alarmTestIntervalMonths),
          retentionYears: numOrNull(values.retentionYears),
          minTechnicians: {
            functional_check: Number(values.minFunctionalCheck),
            technical_maintenance: Number(values.minTechnicalMaintenance),
            repair: Number(values.minRepair),
            callback: Number(values.minCallback),
            other: 1,
          },
        },
        features: {
          publicQrPage: values.publicQrPage,
          publicFaultReport: values.publicFaultReport,
          gpsCapture: values.gpsCapture,
        },
      })
      toast(t('common.saved'))
      await refresh()
    })

  return (
    <div>
      <PageHeader title={t('settings.title')} />
      <SettingsNav />
      <form
        className="grid-2"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <div className="card">
          <h2>{t('settings.company')}</h2>
          <Field label={t('settings.companyName')} required error={err.name}>
            <input
              value={v.name}
              readOnly={ro}
              onChange={(e) => form.set('name', e.target.value)}
            />
          </Field>
          <div className="row">
            <Field label={t('settings.eik')} error={err.eik}>
              <input
                value={v.eik}
                readOnly={ro}
                onChange={(e) => form.set('eik', e.target.value)}
              />
            </Field>
            <Field label={t('settings.vatNo')} error={err.vatNo}>
              <input
                value={v.vatNo}
                readOnly={ro}
                onChange={(e) => form.set('vatNo', e.target.value)}
              />
            </Field>
          </div>
          <Field label={t('settings.address')} error={err.address}>
            <input
              value={v.address}
              readOnly={ro}
              onChange={(e) => form.set('address', e.target.value)}
            />
          </Field>
          <div className="row">
            <Field label={t('settings.phone')} error={err.phone}>
              <input
                value={v.phone}
                readOnly={ro}
                onChange={(e) => form.set('phone', e.target.value)}
              />
            </Field>
            <Field
              label={t('settings.emergencyPhone')}
              error={err.emergencyPhone}
              hint={t('settings.emergencyPhoneHint')}
            >
              <input
                value={v.emergencyPhone}
                readOnly={ro}
                onChange={(e) => form.set('emergencyPhone', e.target.value)}
              />
            </Field>
          </div>
          <Field label={t('contacts.email')} error={err.email}>
            <input
              type="email"
              value={v.email}
              readOnly={ro}
              onChange={(e) => form.set('email', e.target.value)}
            />
          </Field>
        </div>
        <div className="card">
          <h2>{t('settings.defaults')}</h2>
          <Field
            label={t('settings.checkIntervalDays')}
            error={err['settings.checkIntervalDays']}
            hint={t('settings.checkIntervalHint')}
          >
            <input
              type="number"
              min={1}
              max={365}
              value={v.checkIntervalDays}
              readOnly={ro}
              onChange={(e) => form.set('checkIntervalDays', e.target.value)}
            />
          </Field>
          <Field label={t('settings.cycleStrategy')} error={err['settings.cycleStrategy']}>
            <select
              value={v.cycleStrategy}
              disabled={ro}
              onChange={(e) =>
                form.set('cycleStrategy', e.target.value as FormValues['cycleStrategy'])
              }
            >
              <option value="rolling">{t('enum.cycleStrategy.rolling')}</option>
              <option value="calendar_month">{t('enum.cycleStrategy.calendar_month')}</option>
            </select>
          </Field>
          <div className="row">
            <Field
              label={t('settings.callbackSlaMinutes')}
              error={err['settings.callbackSlaMinutes']}
            >
              <input
                type="number"
                min={5}
                value={v.callbackSlaMinutes}
                readOnly={ro}
                onChange={(e) => form.set('callbackSlaMinutes', e.target.value)}
              />
            </Field>
            <Field
              label={t('settings.defectFollowUpDays')}
              error={err['settings.defectFollowUpDays']}
            >
              <input
                type="number"
                min={1}
                value={v.defectFollowUpDays}
                readOnly={ro}
                onChange={(e) => form.set('defectFollowUpDays', e.target.value)}
              />
            </Field>
          </div>
          <div className="row">
            <Field
              label={t('settings.inspectionIntervalMonths')}
              error={err['settings.inspectionIntervalMonths']}
              hint={t('settings.defaultsHint')}
            >
              <input
                type="number"
                min={1}
                max={120}
                value={v.inspectionIntervalMonths}
                readOnly={ro}
                onChange={(e) => form.set('inspectionIntervalMonths', e.target.value)}
              />
            </Field>
            <Field
              label={t('settings.firstInspectionIntervalMonths')}
              error={err['settings.firstInspectionIntervalMonths']}
              hint={t('settings.defaultsHint')}
            >
              <input
                type="number"
                min={1}
                max={120}
                value={v.firstInspectionIntervalMonths}
                readOnly={ro}
                onChange={(e) => form.set('firstInspectionIntervalMonths', e.target.value)}
              />
            </Field>
            <Field
              label={t('settings.alarmTestIntervalMonths')}
              error={err['settings.alarmTestIntervalMonths']}
              hint={t('settings.alarmTestHint')}
            >
              <input
                type="number"
                min={1}
                max={60}
                value={v.alarmTestIntervalMonths}
                readOnly={ro}
                onChange={(e) => form.set('alarmTestIntervalMonths', e.target.value)}
              />
            </Field>
          </div>
          <div className="field">
            <span className="field-label">{t('settings.minTechnicians')}</span>
            <div className="row min-techs">
              {(
                [
                  ['minFunctionalCheck', 'functional_check'],
                  ['minTechnicalMaintenance', 'technical_maintenance'],
                  ['minRepair', 'repair'],
                  ['minCallback', 'callback'],
                ] as const
              ).map(([field, kind]) => (
                <label key={field} className="field">
                  <span className="field-label small">{t(`enum.visitKind.${kind}`)}</span>
                  <input
                    type="number"
                    min={1}
                    max={4}
                    value={v[field]}
                    disabled={ro}
                    onChange={(e) => form.set(field, e.target.value)}
                  />
                </label>
              ))}
            </div>
            <span className="field-hint">{t('settings.minTechniciansHint')}</span>
          </div>
          <Field
            label={t('settings.retentionYears')}
            error={err['settings.retentionYears']}
            hint={t('settings.retentionYearsHint')}
          >
            <input
              type="number"
              min={1}
              max={50}
              value={v.retentionYears}
              readOnly={ro}
              onChange={(e) => form.set('retentionYears', e.target.value)}
            />
          </Field>
          <div className="field">
            <span className="field-label">{t('settings.techApp')}</span>
            <div className="check-list">
              <label className="check">
                <input
                  type="checkbox"
                  checked={v.gpsCapture}
                  disabled={ro}
                  onChange={(e) => form.set('gpsCapture', e.target.checked)}
                />
                <span>{t('settings.gpsCapture')}</span>
              </label>
            </div>
          </div>
          <div className="field">
            <span className="field-label">{t('settings.features')}</span>
            <div className="check-list">
              <label className="check">
                <input
                  type="checkbox"
                  checked={v.publicQrPage}
                  disabled={ro}
                  onChange={(e) => form.set('publicQrPage', e.target.checked)}
                />
                <span>{t('settings.publicQrPage')}</span>
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={v.publicFaultReport}
                  disabled={ro}
                  onChange={(e) => form.set('publicFaultReport', e.target.checked)}
                />
                <span>{t('settings.publicFaultReport')}</span>
              </label>
            </div>
          </div>
          <Field
            label={t('settings.tenantLocale')}
            error={err.locale}
            hint={t('settings.tenantLocaleHint')}
          >
            <select
              value={v.locale}
              disabled={ro}
              onChange={(e) => form.set('locale', e.target.value)}
            >
              {locales.map((l) => (
                <option key={l} value={l}>
                  {t(`lang.${l}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('settings.currencyDisplay')} error={err['settings.currencyDisplay']}>
            <select
              value={v.currencyDisplay}
              disabled={ro}
              onChange={(e) =>
                form.set('currencyDisplay', e.target.value as FormValues['currencyDisplay'])
              }
            >
              <option value="EUR">{t('enum.currencyDisplay.EUR')}</option>
              <option value="EUR_BGN">{t('enum.currencyDisplay.EUR_BGN')}</option>
            </select>
          </Field>
          <ErrorBox error={form.error} />
          {canEdit ? (
            <div className="actions">
              <button type="submit" className="btn btn-primary" disabled={form.busy}>
                {t('common.save')}
              </button>
            </div>
          ) : (
            <p className="muted small">{t('settings.readOnly')}</p>
          )}
        </div>
      </form>
      <div className="card narrow">
        <h2>{t('settings.myLanguage')}</h2>
        <p className="muted small">{t('settings.myLanguageHint')}</p>
        <select value={me?.user.locale ?? ''} onChange={(e) => void changeLocale(e.target.value)}>
          <option value="">{t('settings.useTenantLocale')}</option>
          {locales.map((l) => (
            <option key={l} value={l}>
              {t(`lang.${l}`)}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
