import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import type {
  ElevatorDto,
  JobDto,
  JobKind,
  JobLineInput,
  JobLineKind,
  JobOriginType,
} from '@avroleva/contracts'
import { JobKind as JobKindEnum, JobLineKind as JobLineKindEnum } from '@avroleva/contracts'
import { get, post } from '../../lib/api'
import { useI18n } from '../../i18n/I18nProvider'
import { ErrorBox, Field, PageHeader, toast } from '../../components/ui'
import { EnumSelect } from '../../components/EnumSelect'
import { ElevatorSearch } from '../../components/ElevatorSearch'
import { useForm } from '../../components/useForm'
import { useJobsConfig } from '../../components/jobs/jobsConfig'

interface LineDraft {
  kind: JobLineKind
  description: string
  qty: string
  unit: string
  partRef: string
}

interface FormValues {
  kind: JobKind
  title: string
  description: string
  notes: string
}

const emptyLine = (): LineDraft => ({
  kind: 'part',
  description: '',
  qty: '1',
  unit: '',
  partRef: '',
})

/**
 * "Нов ремонт": the elevator (searched, or prefilled from the page the button was pressed on),
 * the kind and title, and the first quote lines. `?elevatorId=&defectId=|callbackId=|visitId=`
 * prefill the origin so the job links back to what triggered it.
 */
export function JobFormPage() {
  const { t, money } = useI18n()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const cfg = useJobsConfig()
  const form = useForm<FormValues>({ kind: 'repair', title: '', description: '', notes: '' })
  const [elevator, setElevator] = useState<ElevatorDto | null>(null)
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()])
  const origin: { type: JobOriginType; id: string | null } = params.get('defectId')
    ? { type: 'defect', id: params.get('defectId') }
    : params.get('callbackId')
      ? { type: 'callback', id: params.get('callbackId') }
      : params.get('visitId')
        ? { type: 'visit', id: params.get('visitId') }
        : { type: 'office', id: null }

  useEffect(() => {
    const id = params.get('elevatorId')
    if (!id) return
    get<ElevatorDto>(`/elevators/${id}`)
      .then(setElevator)
      .catch(() => undefined)
  }, [params])
  useEffect(() => {
    const title = params.get('title')
    if (title) form.set('title', title)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  const vat = cfg?.vatRatePercent ?? 20
  const toCents = (s: string) => Math.round(Number(s.replace(',', '.')) * 100) || 0
  const totals = lines.reduce(
    (sum, l) => sum + Math.round((Number(l.qty.replace(',', '.')) || 0) * toCents(l.unit)),
    0,
  )
  const vatCents = Math.round((totals * vat) / 100)

  const save = () =>
    form.submit(async (values) => {
      if (!elevator) throw new Error(t('callbacks.elevatorRequired'))
      const payload: JobLineInput[] = lines
        .filter((l) => l.description.trim())
        .map((l) => ({
          kind: l.kind,
          description: l.description.trim(),
          qty: Number(l.qty.replace(',', '.')) || 0,
          unitCents: toCents(l.unit),
          partRef: l.partRef.trim() || null,
        }))
      const job = await post<JobDto>('/jobs', {
        elevatorId: elevator.id,
        kind: values.kind,
        title: values.title,
        description: values.description || null,
        notes: values.notes || null,
        originType: origin.type,
        originId: origin.id,
        lines: payload,
      })
      toast(t('common.saved'))
      navigate(`/jobs/${job.id}`)
    })

  const setLine = (i: number, patch: Partial<LineDraft>) =>
    setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)))

  return (
    <div>
      <PageHeader
        back={
          <Link to="/jobs" className="back">
            {t('jobs.title')}
          </Link>
        }
        title={t('jobs.new')}
        subtitle={origin.id ? t(`enum.jobOriginType.${origin.type}`) : undefined}
      />
      <form
        className="grid-2"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <div className="card">
          <h2>{t('jobs.what')}</h2>
          <ElevatorSearch
            value={elevator}
            onChange={setElevator}
            error={form.errors.elevatorId}
            autoFocus={!elevator}
          />
          <Field label={t('jobs.kind')} error={form.errors.kind}>
            <EnumSelect
              value={form.values.kind}
              options={JobKindEnum.options}
              prefix="enum.jobKind"
              onChange={(v) => v && form.set('kind', v)}
            />
          </Field>
          <Field label={t('jobs.jobTitle')} required error={form.errors.title}>
            <input
              value={form.values.title}
              onChange={(e) => form.set('title', e.target.value)}
              maxLength={200}
            />
          </Field>
          <Field label={t('jobs.description')} error={form.errors.description}>
            <textarea
              rows={3}
              value={form.values.description}
              onChange={(e) => form.set('description', e.target.value)}
            />
          </Field>
          <Field label={t('common.notes')} error={form.errors.notes}>
            <textarea
              rows={2}
              value={form.values.notes}
              onChange={(e) => form.set('notes', e.target.value)}
            />
          </Field>
        </div>
        <div className="card">
          <h2>{t('jobs.quote.title')}</h2>
          <p className="muted small">{t('jobs.linesHint')}</p>
          <div className="table-wrap">
            <table className="table compact job-lines">
              <thead>
                <tr>
                  <th>{t('jobs.line.kind')}</th>
                  <th>{t('jobs.line.description')}</th>
                  <th className="num">{t('jobs.line.qty')}</th>
                  <th className="num">{t('jobs.line.unitEur')}</th>
                  <th className="num">{t('jobs.line.total')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td>
                      <EnumSelect
                        value={l.kind}
                        options={JobLineKindEnum.options}
                        prefix="enum.jobLineKind"
                        onChange={(v) => v && setLine(i, { kind: v })}
                      />
                    </td>
                    <td>
                      <input
                        value={l.description}
                        onChange={(e) => setLine(i, { description: e.target.value })}
                        placeholder={t('jobs.line.placeholder')}
                      />
                    </td>
                    <td className="num">
                      <input
                        className="num-input"
                        inputMode="decimal"
                        value={l.qty}
                        onChange={(e) => setLine(i, { qty: e.target.value })}
                      />
                    </td>
                    <td className="num">
                      <input
                        className="num-input"
                        inputMode="decimal"
                        value={l.unit}
                        onChange={(e) => setLine(i, { unit: e.target.value })}
                      />
                    </td>
                    <td className="num">
                      {money(Math.round((Number(l.qty.replace(',', '.')) || 0) * toCents(l.unit)))}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-small"
                        onClick={() => setLines((ls) => ls.filter((_, k) => k !== i))}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            className="btn btn-small"
            onClick={() => setLines((ls) => [...ls, emptyLine()])}
          >
            {t('jobs.addLine')}
          </button>
          <dl className="totals-dl">
            <dt>{t('billing.doc.net')}</dt>
            <dd>{money(totals)}</dd>
            <dt>
              {t('billing.doc.vat')} {vat}%
            </dt>
            <dd>{money(vatCents)}</dd>
            <dt>{t('billing.doc.total')}</dt>
            <dd>
              <strong>{money(totals + vatCents)}</strong>
            </dd>
          </dl>
          <ErrorBox error={form.error} />
          <div className="actions">
            <button type="submit" className="btn btn-primary" disabled={form.busy || !elevator}>
              {t('common.save')}
            </button>
            <Link className="btn" to="/jobs">
              {t('common.cancel')}
            </Link>
          </div>
        </div>
      </form>
    </div>
  )
}
