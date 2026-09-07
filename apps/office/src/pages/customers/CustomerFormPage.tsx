import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import type { CustomerDto, CustomerKind } from '@avroleva/contracts'
import { CustomerKind as CustomerKindEnum } from '@avroleva/contracts'
import { get, patch, post } from '../../lib/api'
import { useI18n } from '../../i18n/I18nProvider'
import { ErrorBox, Field, PageHeader, Spinner, toast } from '../../components/ui'
import { EnumSelect } from '../../components/EnumSelect'
import { useForm } from '../../components/useForm'

interface FormValues {
  name: string
  kind: CustomerKind
  eik: string
  vatNo: string
  billingAddress: string
  invoiceEmail: string
  notes: string
}

export function CustomerFormPage() {
  const { id } = useParams()
  const { t } = useI18n()
  const navigate = useNavigate()
  const form = useForm<FormValues>({
    name: '',
    kind: 'etazhna_sobstvenost',
    eik: '',
    vatNo: '',
    billingAddress: '',
    invoiceEmail: '',
    notes: '',
  })
  const [loaded, setLoaded] = useState(!id)
  const [loadError, setLoadError] = useState<unknown>(null)

  useEffect(() => {
    if (!id) return
    get<CustomerDto>(`/customers/${id}`)
      .then((c) => {
        form.setValues({
          name: c.name,
          kind: c.kind,
          eik: c.eik ?? '',
          vatNo: c.vatNo ?? '',
          billingAddress: c.billingAddress ?? '',
          invoiceEmail: c.invoiceEmail ?? '',
          notes: c.notes ?? '',
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
      const saved = id
        ? await patch<CustomerDto>(`/customers/${id}`, values)
        : await post<CustomerDto>('/customers', values)
      toast(t('common.saved'))
      navigate(`/customers/${saved.id}`)
    })

  return (
    <div>
      <PageHeader
        back={
          <Link to={id ? `/customers/${id}` : '/customers'} className="back">
            {t('customers.title')}
          </Link>
        }
        title={id ? t('customers.edit') : t('customers.new')}
      />
      <form
        className="card narrow"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <Field label={t('customers.name')} required error={err.name}>
          <input value={v.name} onChange={(e) => form.set('name', e.target.value)} />
        </Field>
        <Field label={t('customers.kind')} error={err.kind}>
          <EnumSelect
            value={v.kind}
            options={CustomerKindEnum.options}
            prefix="enum.customerKind"
            onChange={(x) => x && form.set('kind', x)}
          />
        </Field>
        <div className="row">
          <Field label={t('customers.eik')} error={err.eik}>
            <input value={v.eik} onChange={(e) => form.set('eik', e.target.value)} />
          </Field>
          <Field label={t('customers.vatNo')} error={err.vatNo}>
            <input value={v.vatNo} onChange={(e) => form.set('vatNo', e.target.value)} />
          </Field>
        </div>
        <Field label={t('customers.billingAddress')} error={err.billingAddress}>
          <input
            value={v.billingAddress}
            onChange={(e) => form.set('billingAddress', e.target.value)}
          />
        </Field>
        <Field label={t('customers.invoiceEmail')} error={err.invoiceEmail}>
          <input
            type="email"
            value={v.invoiceEmail}
            onChange={(e) => form.set('invoiceEmail', e.target.value)}
          />
        </Field>
        <Field label={t('common.notes')} error={err.notes}>
          <textarea rows={3} value={v.notes} onChange={(e) => form.set('notes', e.target.value)} />
        </Field>
        <ErrorBox error={form.error} />
        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={form.busy}>
            {t('common.save')}
          </button>
          <Link className="btn" to={id ? `/customers/${id}` : '/customers'}>
            {t('common.cancel')}
          </Link>
        </div>
      </form>
    </div>
  )
}
