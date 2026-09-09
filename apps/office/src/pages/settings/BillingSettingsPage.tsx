import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import type {
  BillingConfigDto,
  DunningPreviewDto,
  DunningStageInput,
  LateFeeRuleDto,
  NotificationChannel,
  PaymentProviderName,
  TenantDto,
} from '@avroleva/contracts'
import { isValidIban } from '@avroleva/contracts'
import { ApiError, get, patch, put } from '../../lib/api'
import { useI18n } from '../../i18n/I18nProvider'
import { useAuth } from '../../auth/AuthProvider'
import {
  Badge,
  ConfirmButton,
  ErrorBox,
  Field,
  PageHeader,
  Spinner,
  toast,
} from '../../components/ui'
import { useForm } from '../../components/useForm'
import { SettingsNav } from '../../components/SettingsNav'

const STAGE_CHANNELS: NotificationChannel[] = ['email', 'viber_link', 'in_app']
const TEMPLATE_KEYS = ['dunning_reminder', 'dunning_second', 'dunning_final']
const LATE_FEE_KEY = 'late_fee'

interface FormValues {
  runDay: string
  runEnabled: boolean
  dueDays: string
  beneficiary: string
  iban: string
  bic: string
  bankName: string
  paymentProvider: PaymentProviderName
  showPaymentOnPublicPage: boolean
}

/** Provider notes arrive as i18n keys (billing.provider.*) or free text. */
function providerNote(note: string | null, t: (k: string) => string): string | null {
  if (!note) return null
  return note.startsWith('billing.provider.') ? t(note) : note
}

const toEur = (cents: number) => (cents / 100).toFixed(2)
const toCents = (eur: string) => Math.round(Number(eur || 0) * 100)

/** Settings -> Фактуриране: run day, bank details, provider, dunning stages, late fee, preview. */
export function BillingSettingsPage() {
  const { t } = useI18n()
  const { hasRole, refresh } = useAuth()
  const canEdit = hasRole('owner')
  const ro = !canEdit
  const [tenant, setTenant] = useState<TenantDto | null>(null)
  const [config, setConfig] = useState<BillingConfigDto | null>(null)
  const [loadError, setLoadError] = useState<unknown>(null)
  const form = useForm<FormValues>({
    runDay: '1',
    runEnabled: true,
    dueDays: '',
    beneficiary: '',
    iban: '',
    bic: '',
    bankName: '',
    paymentProvider: 'none',
    showPaymentOnPublicPage: false,
  })

  const loadConfig = useCallback(async () => {
    const c = await get<BillingConfigDto>('/billing/config')
    setConfig(c)
    return c
  }, [])

  useEffect(() => {
    Promise.all([get<TenantDto>('/tenant'), loadConfig()])
      .then(([tn]) => {
        setTenant(tn)
        const b = tn.settings.billing
        form.setValues({
          runDay: String(b.runDay),
          runEnabled: b.runEnabled,
          dueDays: b.dueDays != null ? String(b.dueDays) : '',
          beneficiary: b.bank.beneficiary,
          iban: b.bank.iban,
          bic: b.bank.bic,
          bankName: b.bank.bankName,
          paymentProvider: b.paymentProvider,
          showPaymentOnPublicPage: b.showPaymentOnPublicPage,
        })
      })
      .catch(setLoadError)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (loadError) return <ErrorBox error={loadError} />
  if (!tenant || !config) return <Spinner />
  const v = form.values
  const err = form.errors
  const ibanHint = v.iban.trim() && !isValidIban(v.iban) ? t('billingSettings.ibanInvalid') : ''

  const save = () =>
    form.submit(async (values) => {
      const billing = {
        runDay: Number(values.runDay),
        runEnabled: values.runEnabled,
        ...(values.dueDays.trim() !== '' ? { dueDays: Number(values.dueDays) } : {}),
        bank: {
          beneficiary: values.beneficiary,
          iban: values.iban,
          bic: values.bic,
          bankName: values.bankName,
        },
        paymentProvider: values.paymentProvider,
        bankCsvMapping: tenant.settings.billing.bankCsvMapping ?? null,
        showPaymentOnPublicPage: values.showPaymentOnPublicPage,
      }
      const updated = await patch<TenantDto>('/tenant', { settings: { billing } })
      setTenant(updated)
      toast(t('common.saved'))
      await refresh()
      await loadConfig()
    })

  return (
    <div>
      <PageHeader title={t('billingSettings.title')} subtitle={t('billingSettings.subtitle')} />
      <SettingsNav />
      <form
        className="grid-2"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <div className="card">
          <h2>{t('billingSettings.runTitle')}</h2>
          <p className="muted small">{t('billingSettings.runHint')}</p>
          <div className="row">
            <Field label={t('billingSettings.runDay')} error={err['settings.billing.runDay']}>
              <input
                type="number"
                min={1}
                max={28}
                value={v.runDay}
                readOnly={ro}
                onChange={(e) => form.set('runDay', e.target.value)}
              />
            </Field>
            <Field
              label={t('billingSettings.dueDays')}
              error={err['settings.billing.dueDays']}
              hint={t('billingSettings.dueDaysHint', { days: tenant.settings.invoiceDueDays })}
            >
              <input
                type="number"
                min={0}
                max={120}
                value={v.dueDays}
                readOnly={ro}
                onChange={(e) => form.set('dueDays', e.target.value)}
              />
            </Field>
          </div>
          <div className="check-list">
            <label className="check">
              <input
                type="checkbox"
                checked={v.runEnabled}
                disabled={ro}
                onChange={(e) => form.set('runEnabled', e.target.checked)}
              />
              <span>{t('billingSettings.runEnabled')}</span>
            </label>
          </div>
          <h2 className="sub-head">{t('billingSettings.providerTitle')}</h2>
          <Field
            label={t('billingSettings.paymentProvider')}
            error={err['settings.billing.paymentProvider']}
          >
            <select
              value={v.paymentProvider}
              disabled={ro}
              onChange={(e) => form.set('paymentProvider', e.target.value as PaymentProviderName)}
            >
              {config.providers.map((p) => {
                const note = providerNote(p.note, t)
                const selectable = p.enabled || p.name === 'none' || p.name === v.paymentProvider
                return (
                  <option key={p.name} value={p.name} disabled={!selectable}>
                    {t(`enum.paymentProvider.${p.name}`)}
                    {note && !p.enabled ? ` — ${note}` : ''}
                  </option>
                )
              })}
            </select>
          </Field>
          {(() => {
            const cur = config.providers.find((p) => p.name === v.paymentProvider)
            const note = cur ? providerNote(cur.note, t) : null
            return note ? <p className="muted small">{note}</p> : null
          })()}
          <div className="check-list">
            <label className="check">
              <input
                type="checkbox"
                checked={v.showPaymentOnPublicPage}
                disabled={ro}
                onChange={(e) => form.set('showPaymentOnPublicPage', e.target.checked)}
              />
              <span>{t('billingSettings.showPaymentOnPublicPage')}</span>
            </label>
          </div>
        </div>
        <div className="card">
          <h2>{t('billingSettings.bankTitle')}</h2>
          <p className="muted small">{t('billingSettings.bankHint')}</p>
          <Field
            label={t('billingSettings.beneficiary')}
            error={err['settings.billing.bank.beneficiary']}
          >
            <input
              value={v.beneficiary}
              readOnly={ro}
              maxLength={70}
              onChange={(e) => form.set('beneficiary', e.target.value)}
            />
          </Field>
          <Field
            label={t('pay.iban')}
            error={err['settings.billing.bank.iban'] || ibanHint || undefined}
            hint={t('billingSettings.ibanHint')}
          >
            <input
              value={v.iban}
              readOnly={ro}
              maxLength={40}
              autoCapitalize="characters"
              onChange={(e) => form.set('iban', e.target.value)}
            />
          </Field>
          <div className="row">
            <Field label={t('pay.bic')} error={err['settings.billing.bank.bic']}>
              <input
                value={v.bic}
                readOnly={ro}
                maxLength={11}
                onChange={(e) => form.set('bic', e.target.value)}
              />
            </Field>
            <Field label={t('pay.bankName')} error={err['settings.billing.bank.bankName']}>
              <input
                value={v.bankName}
                readOnly={ro}
                maxLength={120}
                onChange={(e) => form.set('bankName', e.target.value)}
              />
            </Field>
          </div>
          <p className="muted small">
            {t('billingSettings.referenceSample')} <code>{config.referenceSample}</code>
          </p>
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
      <div className="grid-2">
        <StagesEditor config={config} canEdit={canEdit} onSaved={loadConfig} />
        <LateFeeEditor
          rule={
            config.lateFeeRules.find((r) => r.key === LATE_FEE_KEY) ??
            config.lateFeeRules[0] ??
            null
          }
          canEdit={canEdit}
          onSaved={loadConfig}
        />
      </div>
      <DunningPreviewCard />
    </div>
  )
}

/** Dunning stages as data: one row per stage, saved as the tenant's own list. */
function StagesEditor({
  config,
  canEdit,
  onSaved,
}: {
  config: BillingConfigDto
  canEdit: boolean
  onSaved: () => Promise<unknown>
}) {
  const { t } = useI18n()
  const toInputs = (c: BillingConfigDto): DunningStageInput[] =>
    c.stages.map((s) => ({
      key: s.key,
      offsetDays: s.offsetDays,
      channel: s.channel,
      templateKey: s.templateKey,
      lateFeeRuleKey: s.lateFeeRuleKey ?? null,
      active: s.active,
    }))
  const [stages, setStages] = useState<DunningStageInput[]>(() => toInputs(config))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => setStages(toInputs(config)), [config])

  const update = (i: number, patchRow: Partial<DunningStageInput>) =>
    setStages((s) => s.map((row, idx) => (idx === i ? { ...row, ...patchRow } : row)))
  const remove = (i: number) => setStages((s) => s.filter((_, idx) => idx !== i))
  const add = () =>
    setStages((s) => [
      ...s,
      {
        key: `stage_${s.length + 1}`,
        offsetDays: (s[s.length - 1]?.offsetDays ?? 0) + 7,
        channel: 'email',
        templateKey: 'dunning_reminder',
        lateFeeRuleKey: null,
        active: true,
      },
    ])

  const persist = async (list: DunningStageInput[]) => {
    setBusy(true)
    setError(null)
    setErrors({})
    try {
      await put('/billing/dunning-stages', { stages: list })
      toast(t('common.saved'))
      await onSaved()
    } catch (e) {
      if (e instanceof ApiError && e.status === 400) setErrors(e.fieldErrors)
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  const templateOptions = (current: string) =>
    TEMPLATE_KEYS.includes(current) ? TEMPLATE_KEYS : [...TEMPLATE_KEYS, current]

  return (
    <div className="card">
      <div className="card-head">
        <h2>{t('billingSettings.stagesTitle')}</h2>
        <Badge kind={config.stagesCustomised ? 'info' : 'muted'}>
          {config.stagesCustomised
            ? t('billingSettings.stagesCustom')
            : t('billingSettings.stagesDefault')}
        </Badge>
      </div>
      <p className="muted small">{t('billingSettings.stagesHint')}</p>
      <div className="table-wrap">
        <table className="table compact stage-table">
          <thead>
            <tr>
              <th>{t('billingSettings.stageKey')}</th>
              <th className="num">{t('billingSettings.offsetDays')}</th>
              <th>{t('billingSettings.channel')}</th>
              <th>{t('billingSettings.templateKey')}</th>
              <th>{t('billingSettings.lateFeeRule')}</th>
              <th>{t('billingSettings.active')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {stages.map((s, i) => (
              <tr key={i}>
                <td>
                  <input
                    value={s.key}
                    readOnly={!canEdit}
                    maxLength={40}
                    onChange={(e) => update(i, { key: e.target.value })}
                  />
                  {errors[`stages.${i}.key`] ? (
                    <div className="field-error">{errors[`stages.${i}.key`]}</div>
                  ) : null}
                </td>
                <td className="num">
                  <input
                    type="number"
                    min={0}
                    max={365}
                    value={s.offsetDays}
                    readOnly={!canEdit}
                    onChange={(e) => update(i, { offsetDays: Number(e.target.value) })}
                  />
                </td>
                <td>
                  <select
                    value={s.channel}
                    disabled={!canEdit}
                    onChange={(e) => update(i, { channel: e.target.value as NotificationChannel })}
                  >
                    {STAGE_CHANNELS.map((c) => (
                      <option key={c} value={c}>
                        {t(`enum.notificationChannel.${c}`)}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    value={s.templateKey}
                    disabled={!canEdit}
                    onChange={(e) => update(i, { templateKey: e.target.value })}
                  >
                    {templateOptions(s.templateKey).map((k) => (
                      <option key={k} value={k}>
                        {TEMPLATE_KEYS.includes(k) ? t(`billingSettings.template.${k}`) : k}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    value={s.lateFeeRuleKey ?? ''}
                    disabled={!canEdit}
                    onChange={(e) => update(i, { lateFeeRuleKey: e.target.value || null })}
                  >
                    <option value="">{t('common.none')}</option>
                    {config.lateFeeRules.map((r) => (
                      <option key={r.key} value={r.key}>
                        {r.key}
                        {r.enabled ? '' : ` (${t('billingSettings.ruleDisabled')})`}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={s.active}
                    disabled={!canEdit}
                    onChange={(e) => update(i, { active: e.target.checked })}
                  />
                </td>
                <td className="num">
                  {canEdit ? (
                    <button type="button" className="btn btn-small" onClick={() => remove(i)}>
                      {t('billingSettings.removeStage')}
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
            {stages.length === 0 ? (
              <tr>
                <td colSpan={7} className="muted">
                  {t('billingSettings.noStages')}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <ErrorBox error={error} />
      {canEdit ? (
        <div className="actions">
          <button type="button" className="btn btn-small" onClick={add} disabled={busy}>
            {t('billingSettings.addStage')}
          </button>
          <button
            type="button"
            className="btn btn-primary btn-small"
            disabled={busy}
            onClick={() => void persist(stages)}
          >
            {t('common.save')}
          </button>
          {config.stagesCustomised ? (
            <ConfirmButton
              className="btn btn-small"
              label={t('billingSettings.restoreDefault')}
              disabled={busy}
              onConfirm={() => persist([])}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/** The `late_fee` rule: flat or percent, grace days, cap, on/off (off by default). */
function LateFeeEditor({
  rule,
  canEdit,
  onSaved,
}: {
  rule: LateFeeRuleDto | null
  canEdit: boolean
  onSaved: () => Promise<unknown>
}) {
  const { t } = useI18n()
  const [kind, setKind] = useState<'flat' | 'percent'>(rule?.kind ?? 'flat')
  const [amountEur, setAmountEur] = useState(toEur(rule?.amountCents ?? 0))
  const [percent, setPercent] = useState(((rule?.percentBp ?? 0) / 100).toFixed(2))
  const [graceDays, setGraceDays] = useState(String(rule?.graceDays ?? 0))
  const [capEur, setCapEur] = useState(rule?.capCents != null ? toEur(rule.capCents) : '')
  const [enabled, setEnabled] = useState(rule?.enabled ?? false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const key = rule?.key ?? LATE_FEE_KEY

  useEffect(() => {
    if (!rule) return
    setKind(rule.kind)
    setAmountEur(toEur(rule.amountCents))
    setPercent((rule.percentBp / 100).toFixed(2))
    setGraceDays(String(rule.graceDays))
    setCapEur(rule.capCents != null ? toEur(rule.capCents) : '')
    setEnabled(rule.enabled)
  }, [rule])

  const save = async () => {
    setBusy(true)
    setError(null)
    setErrors({})
    try {
      await put(`/billing/late-fee-rules/${key}`, {
        kind,
        amountCents: toCents(amountEur),
        percentBp: Math.round(Number(percent || 0) * 100),
        graceDays: Number(graceDays || 0),
        capCents: capEur.trim() === '' ? null : toCents(capEur),
        enabled,
      })
      toast(t('common.saved'))
      await onSaved()
    } catch (e) {
      if (e instanceof ApiError && e.status === 400) setErrors(e.fieldErrors)
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <div className="card-head">
        <h2>{t('billingSettings.lateFeeTitle')}</h2>
        <Badge kind={enabled ? 'ok' : 'muted'}>
          {enabled ? t('billingSettings.ruleEnabled') : t('billingSettings.ruleDisabled')}
        </Badge>
      </div>
      <p className="muted small">{t('billingSettings.lateFeeHint')}</p>
      <div className="row">
        <Field label={t('billingSettings.lateFeeKind')} error={errors.kind}>
          <select
            value={kind}
            disabled={!canEdit}
            onChange={(e) => setKind(e.target.value as 'flat' | 'percent')}
          >
            <option value="flat">{t('enum.lateFeeKind.flat')}</option>
            <option value="percent">{t('enum.lateFeeKind.percent')}</option>
          </select>
        </Field>
        {kind === 'flat' ? (
          <Field label={t('billingSettings.lateFeeAmount')} error={errors.amountCents}>
            <input
              type="number"
              min={0}
              step="0.01"
              value={amountEur}
              readOnly={!canEdit}
              onChange={(e) => setAmountEur(e.target.value)}
            />
          </Field>
        ) : (
          <Field label={t('billingSettings.lateFeePercent')} error={errors.percentBp}>
            <input
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={percent}
              readOnly={!canEdit}
              onChange={(e) => setPercent(e.target.value)}
            />
          </Field>
        )}
      </div>
      <div className="row">
        <Field
          label={t('billingSettings.graceDays')}
          error={errors.graceDays}
          hint={t('billingSettings.graceDaysHint')}
        >
          <input
            type="number"
            min={0}
            max={365}
            value={graceDays}
            readOnly={!canEdit}
            onChange={(e) => setGraceDays(e.target.value)}
          />
        </Field>
        <Field
          label={t('billingSettings.capAmount')}
          error={errors.capCents}
          hint={t('billingSettings.capHint')}
        >
          <input
            type="number"
            min={0}
            step="0.01"
            value={capEur}
            readOnly={!canEdit}
            onChange={(e) => setCapEur(e.target.value)}
          />
        </Field>
      </div>
      <div className="check-list">
        <label className="check">
          <input
            type="checkbox"
            checked={enabled}
            disabled={!canEdit}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <span>{t('billingSettings.lateFeeEnabled')}</span>
        </label>
      </div>
      <ErrorBox error={error} />
      {canEdit ? (
        <div className="actions">
          <button
            type="button"
            className="btn btn-primary btn-small"
            disabled={busy}
            onClick={() => void save()}
          >
            {t('common.save')}
          </button>
        </div>
      ) : null}
    </div>
  )
}

/** "Преглед на напомнянията": what the next dunning run would do, per open invoice. */
function DunningPreviewCard() {
  const { t, date, moneyFull } = useI18n()
  const [preview, setPreview] = useState<DunningPreviewDto | null>(null)
  const [error, setError] = useState<unknown>(null)
  const dash = <span className="muted">—</span>

  useEffect(() => {
    let cancelled = false
    get<DunningPreviewDto>('/billing/dunning/preview')
      .then((p) => !cancelled && setPreview(p))
      .catch((e) => !cancelled && setError(e))
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="card">
      <div className="card-head">
        <h2>{t('billingSettings.previewTitle')}</h2>
        {preview ? (
          <span className="muted small">
            {t('billingSettings.previewToday', { date: date(preview.today) })}
          </span>
        ) : null}
      </div>
      <p className="muted small">{t('billingSettings.previewHint')}</p>
      <ErrorBox error={error} />
      {!preview && !error ? (
        <Spinner />
      ) : !preview || preview.items.length === 0 ? (
        <p className="muted">{t('billingSettings.previewEmpty')}</p>
      ) : (
        <div className="table-wrap">
          <table className="table compact">
            <thead>
              <tr>
                <th>{t('payments.invoiceNo')}</th>
                <th>{t('payments.building')}</th>
                <th>{t('payments.customer')}</th>
                <th className="num">{t('invoices.open')}</th>
                <th>{t('payments.dueAt')}</th>
                <th>{t('payments.daysOverdue')}</th>
                <th>{t('billingSettings.previewStage')}</th>
                <th>{t('billingSettings.channel')}</th>
                <th className="num">{t('billing.doc.lateFee')}</th>
              </tr>
            </thead>
            <tbody>
              {preview.items.map((it) => (
                <tr key={it.invoiceId}>
                  <td>
                    <Link to={`/invoices/${it.invoiceId}`}>{it.number}</Link>
                  </td>
                  <td>{it.buildingAddressText ?? dash}</td>
                  <td>{it.customerName ?? dash}</td>
                  <td className="num">{moneyFull(it.openCents)}</td>
                  <td>{date(it.dueAt)}</td>
                  <td>
                    {it.daysOverdue > 0 ? (
                      <Badge kind="danger">
                        {t('payments.overdueBy', { count: it.daysOverdue })}
                      </Badge>
                    ) : (
                      dash
                    )}
                  </td>
                  <td>
                    {it.currentStage} → {it.nextStagePosition}{' '}
                    <span className="muted small">({it.nextStageKey})</span>
                  </td>
                  <td>{t(`enum.notificationChannel.${it.channel}`)}</td>
                  <td className="num">{it.lateFeeCents > 0 ? moneyFull(it.lateFeeCents) : dash}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
