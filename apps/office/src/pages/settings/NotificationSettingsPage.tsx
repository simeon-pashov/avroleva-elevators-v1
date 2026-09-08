import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  NotifiableEventType,
  NotificationChannel,
  NotificationDto,
  NotificationRuleConfig,
  NotificationRuleDto,
  NotificationTemplateDto,
  RecipientKind,
  RenderedNotificationDto,
} from '@avroleva/contracts'
import {
  NotificationChannel as NotificationChannelEnum,
  RULE_MATRIX,
  SYSTEM_TEMPLATE_KEYS,
  TEMPLATE_KEY_BY_EVENT,
} from '@avroleva/contracts'
import { del, get, post, put } from '../../lib/api'
import { useI18n } from '../../i18n/I18nProvider'
import { useAuth } from '../../auth/AuthProvider'
import { Badge, ErrorBox, Field, PageHeader, Spinner, toast } from '../../components/ui'
import { SettingsNav } from '../../components/SettingsNav'

interface RuleKey {
  eventType: NotifiableEventType
  channel: NotificationChannel
  recipientKind: RecipientKind
}
const keyOf = (r: RuleKey) => `${r.eventType}/${r.channel}/${r.recipientKind}`

/** Alert steps offered for InspectionDueSoon (days before the due date). */
const DAY_STEPS = [7, 30, 60, 90]

/** The sample-data paths the preview renders with (see the API's sampleData). */
const VARIABLES = [
  'tenant.name',
  'tenant.phone',
  'tenant.emergencyPhone',
  'building.addressText',
  'building.customerName',
  'elevator.internalNo',
  'elevator.regNo',
  'contact.name',
  'user.name',
  'visit.date',
  'visit.kindLabel',
  'visit.technicians',
  'visit.defects',
  'visit.notes',
  'callback.receivedAt',
  'callback.description',
  'callback.classificationLabel',
  'callback.responseMinutes',
  'callback.slaMinutes',
  'callback.cause',
  'callback.actionTaken',
  'invoice.number',
  'invoice.period',
  'invoice.totalCents',
  'invoice.dueAt',
  'inspection.dueAt',
  'inspection.inDays',
  'defect.description',
  'defect.followUpDueAt',
  'check.dueAt',
  'check.overdueDays',
  'report.periodLabel',
  'link',
]

const EVENT_KEYS = Object.keys(TEMPLATE_KEY_BY_EVENT) as NotifiableEventType[]

/** Settings -> Уведомления: the rule matrix (toggle = saved at once) and the template editor. */
export function NotificationSettingsPage() {
  const { t } = useI18n()
  const { hasRole } = useAuth()
  const [rules, setRules] = useState<Record<string, NotificationRuleDto> | null>(null)
  const [templates, setTemplates] = useState<NotificationTemplateDto[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [saving, setSaving] = useState<string | null>(null)

  const loadRules = useCallback(async () => {
    const r = await get<{ items: NotificationRuleDto[] }>('/notifications/rules')
    setRules(Object.fromEntries(r.items.map((x) => [keyOf(x), x])))
  }, [])
  const loadTemplates = useCallback(async () => {
    setTemplates(
      (await get<{ items: NotificationTemplateDto[] }>('/notifications/templates')).items,
    )
  }, [])

  useEffect(() => {
    Promise.all([loadRules(), loadTemplates()]).catch(setError)
  }, [loadRules, loadTemplates])

  const events = useMemo(() => {
    const seen: NotifiableEventType[] = []
    for (const r of RULE_MATRIX) if (!seen.includes(r.eventType)) seen.push(r.eventType)
    return seen
  }, [])

  const updateRule = async (
    key: RuleKey,
    body: { enabled?: boolean; config?: NotificationRuleConfig },
  ) => {
    const k = keyOf(key)
    setSaving(k)
    try {
      const r = await put<NotificationRuleDto>(
        `/notifications/rules/${key.eventType}/${key.channel}/${key.recipientKind}`,
        body,
      )
      setRules((prev) => ({ ...(prev ?? {}), [k]: r }))
      toast(t('notifications.ruleSaved'))
    } catch (e) {
      toast(e instanceof Error ? e.message : t('error.internal'), 'error')
    } finally {
      setSaving(null)
    }
  }

  if (error) return <ErrorBox error={error} />
  if (!rules || !templates) return <Spinner />

  return (
    <div>
      <PageHeader
        title={t('notifications.settingsTitle')}
        subtitle={t('notifications.settingsSubtitle')}
      />
      <SettingsNav />
      <div className="card">
        <div className="card-head">
          <h2>{t('notifications.rulesTitle')}</h2>
          <span className="muted small">{t('notifications.rulesHint')}</span>
        </div>
        <ul className="muted small rule-hints">
          <li>{t('notifications.viberLinkHint')}</li>
          <li>{t('notifications.smsHint')}</li>
        </ul>
        <div className="rule-groups">
          {events.map((ev) => (
            <section key={ev} className="rule-group">
              <h3 className="sub-head">{t(`notifications.event.${ev}`)}</h3>
              <ul className="list compact rule-list">
                {RULE_MATRIX.filter((r) => r.eventType === ev).map((r) => {
                  const k = keyOf(r)
                  const rule = rules[k]
                  const enabled = rule?.enabled ?? false
                  const config = rule?.config ?? {}
                  const busy = saving === k
                  const showFallback =
                    r.channel === 'email' && r.recipientKind === 'building_contact'
                  const showDays = r.eventType === 'InspectionDueSoon'
                  const days = config.days ?? []
                  return (
                    <li key={k} className="rule-row">
                      <label className="check rule-main">
                        <input
                          type="checkbox"
                          checked={enabled}
                          disabled={busy}
                          onChange={(e) => updateRule(r, { enabled: e.target.checked })}
                        />
                        <Badge kind={r.channel === 'sms' ? 'warn' : enabled ? 'info' : 'muted'}>
                          {t(`enum.notificationChannel.${r.channel}`)}
                        </Badge>
                        <span>{t(`enum.recipientKind.${r.recipientKind}`)}</span>
                      </label>
                      {showFallback ? (
                        <label className="check small rule-extra">
                          <input
                            type="checkbox"
                            checked={!!config.fallbackViberLink}
                            disabled={busy}
                            onChange={(e) =>
                              updateRule(r, {
                                config: { ...config, fallbackViberLink: e.target.checked },
                              })
                            }
                          />
                          <span>{t('notifications.fallbackViber')}</span>
                        </label>
                      ) : null}
                      {showDays ? (
                        <span className="rule-extra rule-days">
                          <span className="muted small">{t('notifications.days')}:</span>
                          {[...new Set([...DAY_STEPS, ...days])]
                            .sort((a, b) => a - b)
                            .map((d) => {
                              const on = days.includes(d)
                              return (
                                <button
                                  key={d}
                                  type="button"
                                  className={`chip${on ? ' active' : ''}`}
                                  disabled={busy}
                                  aria-pressed={on}
                                  onClick={() =>
                                    updateRule(r, {
                                      config: {
                                        ...config,
                                        days: on
                                          ? days.filter((x) => x !== d)
                                          : [...days, d].sort((a, b) => a - b),
                                      },
                                    })
                                  }
                                >
                                  {d}
                                </button>
                              )
                            })}
                        </span>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      </div>
      <TemplateEditor templates={templates} reload={loadTemplates} canEdit={hasRole('owner')} />
    </div>
  )
}

function TemplateEditor({
  templates,
  reload,
  canEdit,
}: {
  templates: NotificationTemplateDto[]
  reload: () => Promise<void>
  canEdit: boolean
}) {
  const { t, locale, locales } = useI18n()
  const [key, setKey] = useState<string>(TEMPLATE_KEY_BY_EVENT.VisitRecorded)
  const [channel, setChannel] = useState<NotificationChannel>('email')
  const [tplLocale, setTplLocale] = useState(locale)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [preview, setPreview] = useState<RenderedNotificationDto | null>(null)
  const [previewError, setPreviewError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const [testChannel, setTestChannel] = useState<'in_app' | 'email'>('in_app')
  const [testTo, setTestTo] = useState('')

  const channelsForKey = useMemo(
    () =>
      NotificationChannelEnum.options.filter((c) =>
        templates.some((x) => x.key === key && x.channel === c),
      ),
    [templates, key],
  )
  const localesForKey = useMemo(
    () =>
      locales.filter((l) =>
        templates.some((x) => x.key === key && x.channel === channel && x.locale === l),
      ),
    [templates, key, channel, locales],
  )
  // Keep the selection valid when the key changes.
  const effChannel = channelsForKey.includes(channel) ? channel : (channelsForKey[0] ?? channel)
  const effLocale = localesForKey.includes(tplLocale) ? tplLocale : (localesForKey[0] ?? tplLocale)

  const stored = useMemo(() => {
    const rows = templates.filter(
      (x) => x.key === key && x.channel === effChannel && x.locale === effLocale,
    )
    return rows.find((x) => x.tenantId) ?? rows.find((x) => !x.tenantId) ?? null
  }, [templates, key, effChannel, effLocale])
  const isCustom = !!stored?.tenantId

  const runPreview = useCallback(
    async (draft?: { subject: string; body: string }) => {
      setBusy(true)
      setPreviewError(null)
      try {
        setPreview(
          await post<RenderedNotificationDto>('/notifications/templates/preview', {
            key,
            channel: effChannel,
            locale: effLocale,
            ...(draft ? { subject: draft.subject || null, body: draft.body } : {}),
          }),
        )
      } catch (e) {
        setPreviewError(e)
      } finally {
        setBusy(false)
      }
    },
    [key, effChannel, effLocale],
  )

  useEffect(() => {
    setSubject(stored?.subject ?? '')
    setBody(stored?.body ?? '')
    void runPreview()
  }, [stored, runPreview])

  const testChannels = (['in_app', 'email'] as const).filter((c) => channelsForKey.includes(c))
  const effTestChannel = testChannels.includes(testChannel) ? testChannel : testChannels[0]

  const save = async () => {
    setBusy(true)
    try {
      await put(`/notifications/templates/${key}/${effChannel}/${effLocale}`, {
        subject: subject.trim() === '' ? null : subject,
        body,
      })
      toast(t('notifications.templateSaved'))
      await reload()
    } catch (e) {
      setPreviewError(e)
    } finally {
      setBusy(false)
    }
  }

  const reset = async () => {
    setBusy(true)
    try {
      await del(`/notifications/templates/${key}/${effChannel}/${effLocale}`)
      toast(t('notifications.templateReset'))
      await reload()
    } catch (e) {
      setPreviewError(e)
    } finally {
      setBusy(false)
    }
  }

  const testSend = async () => {
    if (!effTestChannel) return
    setBusy(true)
    try {
      const n = await post<NotificationDto>('/notifications/test-send', {
        key,
        channel: effTestChannel,
        ...(effTestChannel === 'email' && testTo.trim() ? { to: testTo.trim() } : {}),
      })
      toast(t('notifications.testSent', { status: t(`enum.notificationStatus.${n.status}`) }))
    } catch (e) {
      toast(e instanceof Error ? e.message : t('error.internal'), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <h2>{t('notifications.templatesTitle')}</h2>
      <p className="muted small">{t('notifications.templatesHint')}</p>
      <div className="row">
        <Field label={t('notifications.templateEvent')}>
          <select value={key} onChange={(e) => setKey(e.target.value)}>
            {EVENT_KEYS.map((ev) => (
              <option key={ev} value={TEMPLATE_KEY_BY_EVENT[ev]}>
                {t(`notifications.event.${ev}`)}
              </option>
            ))}
            <optgroup label={t('notifications.templateOther')}>
              {SYSTEM_TEMPLATE_KEYS.map((k) => (
                <option key={k} value={k}>
                  {t(`notifications.template.${k}`)}
                </option>
              ))}
            </optgroup>
          </select>
        </Field>
        <Field label={t('notifications.channel')}>
          <select
            value={effChannel}
            onChange={(e) => setChannel(e.target.value as NotificationChannel)}
          >
            {channelsForKey.map((c) => (
              <option key={c} value={c}>
                {t(`enum.notificationChannel.${c}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('common.language')}>
          <select value={effLocale} onChange={(e) => setTplLocale(e.target.value)}>
            {localesForKey.map((l) => (
              <option key={l} value={l}>
                {t(`lang.${l}`)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="grid-2 template-grid">
        <div>
          <div className="card-head">
            <h3 className="sub-head">{t('notifications.body')}</h3>
            <Badge kind={isCustom ? 'info' : 'muted'}>
              {isCustom ? t('notifications.customTemplate') : t('notifications.systemTemplate')}
            </Badge>
          </div>
          {effChannel === 'email' || effChannel === 'in_app' ? (
            <Field label={t('notifications.subject')}>
              <input
                value={subject}
                readOnly={!canEdit}
                onChange={(e) => setSubject(e.target.value)}
              />
            </Field>
          ) : null}
          <Field label={t('notifications.body')}>
            <textarea
              rows={12}
              className="template-body"
              value={body}
              readOnly={!canEdit}
              onChange={(e) => setBody(e.target.value)}
            />
          </Field>
          <div className="actions">
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => runPreview({ subject, body })}
            >
              {t('notifications.preview')}
            </button>
            {canEdit ? (
              <>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy || body.trim() === ''}
                  onClick={save}
                >
                  {t('notifications.saveTemplate')}
                </button>
                {isCustom ? (
                  <button type="button" className="btn" disabled={busy} onClick={reset}>
                    {t('notifications.resetTemplate')}
                  </button>
                ) : null}
              </>
            ) : (
              <span className="muted small">{t('notifications.templateReadOnly')}</span>
            )}
          </div>
          <details className="template-vars">
            <summary className="small">{t('notifications.variablesTitle')}</summary>
            <p className="muted small">{t('notifications.variablesHint')}</p>
            <div className="template-var-list">
              {VARIABLES.map((v) => (
                <code key={v}>{`{{${v}}}`}</code>
              ))}
            </div>
          </details>
        </div>
        <div>
          <h3 className="sub-head">{t('notifications.previewTitle')}</h3>
          <ErrorBox error={previewError} />
          {preview ? (
            <div className="template-preview">
              {preview.subject ? <div className="notif-subject">{preview.subject}</div> : null}
              <pre className="viber-text">{preview.body}</pre>
            </div>
          ) : busy ? (
            <Spinner />
          ) : null}
          {testChannels.length > 0 && effTestChannel ? (
            <div className="inline-form">
              <h3 className="sub-head">{t('notifications.testSend')}</h3>
              <p className="muted small">{t('notifications.testSendHint')}</p>
              <div className="row">
                <Field label={t('notifications.channel')}>
                  <select
                    value={effTestChannel}
                    onChange={(e) => setTestChannel(e.target.value as 'in_app' | 'email')}
                  >
                    {testChannels.map((c) => (
                      <option key={c} value={c}>
                        {t(`enum.notificationChannel.${c}`)}
                      </option>
                    ))}
                  </select>
                </Field>
                {effTestChannel === 'email' ? (
                  <Field label={t('notifications.testSendTo')}>
                    <input
                      type="email"
                      value={testTo}
                      onChange={(e) => setTestTo(e.target.value)}
                    />
                  </Field>
                ) : null}
              </div>
              <button type="button" className="btn" disabled={busy} onClick={testSend}>
                {t('notifications.testSend')}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
