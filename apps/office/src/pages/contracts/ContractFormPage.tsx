import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import type {
  BillingCycle,
  BuildingDto,
  ContractDto,
  ContractStatus,
  CustomerDto,
  ElevatorDto,
  Page,
} from '@avroleva/contracts'
import {
  BillingCycle as BillingCycleEnum,
  ContractStatus as ContractStatusEnum,
} from '@avroleva/contracts'
import { get, patch, post, qs } from '../../lib/api'
import { useI18n } from '../../i18n/I18nProvider'
import { ErrorBox, Field, PageHeader, Spinner, toast } from '../../components/ui'
import { EnumSelect } from '../../components/EnumSelect'
import { useForm } from '../../components/useForm'

interface Line {
  elevatorId: string
  priceEur: string
}

interface FormValues {
  customerId: string
  buildingId: string
  startDate: string
  endDate: string
  status: ContractStatus
  paymentDay: string
  billingCycle: BillingCycle
  billingAnchorDay: string
  billingExempt: boolean
  notes: string
  lines: Line[]
}

export function ContractFormPage() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const { t, money } = useI18n()
  const navigate = useNavigate()
  const form = useForm<FormValues>({
    customerId: params.get('customerId') ?? '',
    buildingId: params.get('buildingId') ?? '',
    startDate: new Date().toISOString().slice(0, 10),
    endDate: '',
    status: 'active',
    paymentDay: '10',
    billingCycle: 'monthly',
    billingAnchorDay: '',
    billingExempt: false,
    notes: '',
    lines: [],
  })
  const [customers, setCustomers] = useState<CustomerDto[]>([])
  const [buildings, setBuildings] = useState<BuildingDto[]>([])
  const [elevators, setElevators] = useState<ElevatorDto[]>([])
  const [loaded, setLoaded] = useState(!id)
  const [loadError, setLoadError] = useState<unknown>(null)

  useEffect(() => {
    Promise.all([
      get<Page<CustomerDto>>(`/customers${qs({ limit: 200 })}`),
      get<Page<BuildingDto>>(`/buildings${qs({ limit: 200 })}`),
    ])
      .then(([c, b]) => {
        setCustomers(c.items)
        setBuildings(b.items)
      })
      .catch(setLoadError)
  }, [])

  useEffect(() => {
    if (!id) return
    get<ContractDto>(`/contracts/${id}`)
      .then((c) => {
        form.setValues({
          customerId: c.customerId,
          buildingId: c.buildingId,
          startDate: c.startDate,
          endDate: c.endDate ?? '',
          status: c.status,
          paymentDay: c.paymentDay?.toString() ?? '',
          billingCycle: c.billing?.cycle ?? 'monthly',
          billingAnchorDay: c.billing?.anchorDay?.toString() ?? '',
          billingExempt: c.billing?.exempt ?? false,
          notes: c.notes ?? '',
          lines: c.lines
            .filter((l) => !l.toDate)
            .map((l) => ({
              elevatorId: l.elevatorId,
              priceEur: (l.monthlyPriceCents / 100).toFixed(2),
            })),
        })
        setLoaded(true)
      })
      .catch(setLoadError)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const buildingId = form.values.buildingId
  useEffect(() => {
    if (!buildingId) {
      setElevators([])
      return
    }
    get<Page<ElevatorDto>>(`/elevators${qs({ buildingId, limit: 200 })}`)
      .then((p) => {
        setElevators(p.items)
        // Pre-select all elevators of the building for a new contract.
        form.setValues((s) =>
          s.lines.length === 0
            ? { ...s, lines: p.items.map((e) => ({ elevatorId: e.id, priceEur: '' })) }
            : s,
        )
        const b = buildings.find((x) => x.id === buildingId)
        if (b?.customerId)
          form.setValues((s) => (s.customerId ? s : { ...s, customerId: b.customerId! }))
      })
      .catch(setLoadError)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildingId])

  if (loadError) return <ErrorBox error={loadError} />
  if (!loaded) return <Spinner />
  const v = form.values
  const err = form.errors
  const toggleLine = (elevatorId: string, on: boolean) =>
    form.set(
      'lines',
      on
        ? [...v.lines, { elevatorId, priceEur: '' }]
        : v.lines.filter((l) => l.elevatorId !== elevatorId),
    )
  const setPrice = (elevatorId: string, priceEur: string) =>
    form.set(
      'lines',
      v.lines.map((l) => (l.elevatorId === elevatorId ? { ...l, priceEur } : l)),
    )
  const totalCents = v.lines.reduce((s, l) => s + Math.round(Number(l.priceEur || 0) * 100), 0)

  const save = () =>
    form.submit(async (values) => {
      const body = {
        customerId: values.customerId,
        buildingId: values.buildingId,
        startDate: values.startDate,
        endDate: values.endDate || null,
        status: values.status,
        paymentDay: values.paymentDay ? Number(values.paymentDay) : null,
        // null = the tenant default (monthly, run day, not exempt).
        billing:
          values.billingCycle === 'monthly' && !values.billingAnchorDay && !values.billingExempt
            ? null
            : {
                cycle: values.billingCycle,
                anchorDay: values.billingAnchorDay ? Number(values.billingAnchorDay) : null,
                exempt: values.billingExempt,
              },
        notes: values.notes,
        lines: values.lines.map((l) => ({
          elevatorId: l.elevatorId,
          monthlyPriceCents: Math.round(Number(l.priceEur || 0) * 100),
        })),
      }
      const saved = id
        ? await patch<ContractDto>(`/contracts/${id}`, body)
        : await post<ContractDto>('/contracts', body)
      toast(t('common.saved'))
      navigate(`/contracts/${saved.id}`)
    })

  return (
    <div>
      <PageHeader
        back={
          <Link to={id ? `/contracts/${id}` : '/contracts'} className="back">
            {t('contracts.title')}
          </Link>
        }
        title={id ? t('contracts.edit') : t('contracts.new')}
      />
      <form
        className="grid-2"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <div className="card">
          <h2>{t('contracts.details')}</h2>
          <Field label={t('contracts.building')} required error={err.buildingId}>
            <select
              value={v.buildingId}
              disabled={!!id}
              onChange={(e) =>
                form.setValues((s) => ({ ...s, buildingId: e.target.value, lines: [] }))
              }
            >
              <option value="">{t('common.choose')}</option>
              {buildings.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.addressText}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('contracts.customer')} required error={err.customerId}>
            <select value={v.customerId} onChange={(e) => form.set('customerId', e.target.value)}>
              <option value="">{t('common.choose')}</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="row">
            <Field label={t('contracts.startDate')} required error={err.startDate}>
              <input
                type="date"
                value={v.startDate}
                onChange={(e) => form.set('startDate', e.target.value)}
              />
            </Field>
            <Field label={t('contracts.endDate')} error={err.endDate}>
              <input
                type="date"
                value={v.endDate}
                onChange={(e) => form.set('endDate', e.target.value)}
              />
            </Field>
          </div>
          <div className="row">
            <Field label={t('contracts.status')} error={err.status}>
              <EnumSelect
                value={v.status}
                options={ContractStatusEnum.options.filter((s) => s !== 'terminated')}
                prefix="enum.contractStatus"
                onChange={(x) => x && form.set('status', x)}
              />
            </Field>
            <Field label={t('contracts.paymentDay')} error={err.paymentDay}>
              <input
                type="number"
                min={1}
                max={28}
                value={v.paymentDay}
                onChange={(e) => form.set('paymentDay', e.target.value)}
              />
            </Field>
          </div>
          <h3 className="sub-head">{t('contracts.billingTitle')}</h3>
          <p className="muted small">{t('contracts.billingHint')}</p>
          <div className="row">
            <Field label={t('contracts.billingCycle')} error={err['billing.cycle']}>
              <EnumSelect
                value={v.billingCycle}
                options={BillingCycleEnum.options}
                prefix="enum.billingCycle"
                onChange={(x) => x && form.set('billingCycle', x)}
              />
            </Field>
            <Field
              label={t('contracts.billingAnchorDay')}
              error={err['billing.anchorDay']}
              hint={t('contracts.billingAnchorDayHint')}
            >
              <input
                type="number"
                min={1}
                max={28}
                value={v.billingAnchorDay}
                onChange={(e) => form.set('billingAnchorDay', e.target.value)}
              />
            </Field>
          </div>
          <div className="check-list">
            <label className="check">
              <input
                type="checkbox"
                checked={v.billingExempt}
                onChange={(e) => form.set('billingExempt', e.target.checked)}
              />
              <span>{t('contracts.billingExempt')}</span>
            </label>
          </div>
          <Field label={t('common.notes')} error={err.notes}>
            <textarea
              rows={3}
              value={v.notes}
              onChange={(e) => form.set('notes', e.target.value)}
            />
          </Field>
        </div>
        <div className="card">
          <h2>{t('contracts.lines')}</h2>
          {!v.buildingId ? (
            <p className="muted">{t('contracts.chooseBuildingFirst')}</p>
          ) : elevators.length === 0 ? (
            <p className="muted">{t('buildings.noElevators')}</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th></th>
                  <th>{t('elevators.one')}</th>
                  <th className="num">{t('contracts.monthlyPriceEur')}</th>
                </tr>
              </thead>
              <tbody>
                {elevators.map((e) => {
                  const line = v.lines.find((l) => l.elevatorId === e.id)
                  return (
                    <tr key={e.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={!!line}
                          onChange={(ev) => toggleLine(e.id, ev.target.checked)}
                        />
                      </td>
                      <td>
                        {e.internalNo}{' '}
                        <span className="muted small">{t(`enum.elevatorStatus.${e.status}`)}</span>
                      </td>
                      <td className="num">
                        <input
                          className="price"
                          type="number"
                          min={0}
                          step="0.01"
                          disabled={!line}
                          value={line?.priceEur ?? ''}
                          onChange={(ev) => setPrice(e.id, ev.target.value)}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr>
                  <th colSpan={2}>{t('contracts.monthlyTotal')}</th>
                  <th className="num">{money(totalCents)}</th>
                </tr>
              </tfoot>
            </table>
          )}
          {err.lines ? <div className="field-error">{err.lines}</div> : null}
          <ErrorBox error={form.error} />
          <div className="actions">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={form.busy || v.lines.length === 0}
            >
              {t('common.save')}
            </button>
            <Link className="btn" to={id ? `/contracts/${id}` : '/contracts'}>
              {t('common.cancel')}
            </Link>
          </div>
        </div>
      </form>
    </div>
  )
}
