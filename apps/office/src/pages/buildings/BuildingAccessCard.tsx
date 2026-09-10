import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type {
  AccessLinkScope,
  BuildingAccessLinkDto,
  BuildingDetailDto,
  SendAccessLinkResultDto,
} from '@avroleva/contracts'
import {
  ACCESS_LINK_DEFAULT_MONTHS,
  AccessLinkScope as AccessLinkScopeEnum,
} from '@avroleva/contracts'
import { ApiError, get, post } from '../../lib/api'
import { useI18n } from '../../i18n/I18nProvider'
import { Badge, ConfirmButton, ErrorBox, Field, Spinner, toast } from '../../components/ui'

type SendChannel = 'email' | 'viber'

export function accessLinkBadge(state: BuildingAccessLinkDto['state']): 'ok' | 'warn' | 'muted' {
  return state === 'active' ? 'ok' : state === 'expired' ? 'warn' : 'muted'
}

/** The newest active link of the list (the API lists newest first; sorted here to be safe). */
function newestActive(links: BuildingAccessLinkDto[]): BuildingAccessLinkDto | null {
  return (
    links
      .filter((l) => l.state === 'active')
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0] ?? null
  )
}

/**
 * "Достъп за домоуправителя": the building's magic link (`/s/:token`). Shows the active link
 * with its state and use count, copies / sends it (e-mail through the API, Viber as a deep link
 * the office user opens by hand), rotates or revokes it; with no active link, generates one.
 * Previous links stay in a collapsible history.
 */
export function BuildingAccessCard({ building }: { building: BuildingDetailDto }) {
  const { t, date, dateTime } = useI18n()
  const [links, setLinks] = useState<BuildingAccessLinkDto[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const [scope, setScope] = useState<AccessLinkScope>('statement')
  const [months, setMonths] = useState(String(ACCESS_LINK_DEFAULT_MONTHS))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [channel, setChannel] = useState<SendChannel | null>(null)
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [message, setMessage] = useState('')
  const [viber, setViber] = useState<SendAccessLinkResultDto['viber']>(null)

  const base = `/buildings/${building.id}/access-links`

  const load = useCallback(async () => {
    try {
      const r = await get<{ items: BuildingAccessLinkDto[] }>(base)
      setLinks(r.items)
    } catch (e) {
      setError(e)
    }
  }, [base])

  useEffect(() => {
    void load()
  }, [load])

  if (error) return <ErrorBox error={error} />
  if (!links) return <Spinner />

  const active = newestActive(links)
  const history = links.filter((l) => l.id !== active?.id)
  const contacts = building.contacts
  const contactEmail =
    contacts.find((c) => c.isPrimary && c.email)?.email ??
    contacts.find((c) => c.email)?.email ??
    ''
  const contactPhone =
    contacts.find((c) => c.hasViber && c.phone)?.phone ?? contacts.find((c) => c.phone)?.phone ?? ''

  /** Runs a write, reloads the list, resets the errors; 400 field errors land in `errors`. */
  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    setErrors({})
    try {
      await fn()
      await load()
    } catch (e) {
      if (e instanceof ApiError && e.status === 400) {
        setErrors(e.fieldErrors)
        if (e.problem.code === 'accessLinks.noEmail' || e.problem.code === 'accessLinks.noPhone')
          toast(e.problem.title, 'error')
        else if (!e.problem.fields?.length) setError(e)
      } else setError(e)
    } finally {
      setBusy(false)
    }
  }

  const generate = () =>
    run(async () => {
      await post<BuildingAccessLinkDto>(base, { scope, expiresInMonths: Number(months) })
      toast(t('common.saved'))
    })

  const rotate = (link: BuildingAccessLinkDto) =>
    run(async () => {
      await post<BuildingAccessLinkDto>(`${base}/${link.id}/rotate`)
      toast(t('accessLinks.rotated'))
      closeSend()
    })

  const revoke = (link: BuildingAccessLinkDto) =>
    run(async () => {
      await post<BuildingAccessLinkDto>(`${base}/${link.id}/revoke`)
      toast(t('accessLinks.revokedToast'))
      closeSend()
    })

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      toast(t('notifications.copied'))
    } catch {
      toast(t('notifications.copyFailed'), 'error')
    }
  }

  const openSend = (ch: SendChannel) => {
    setChannel(ch)
    setViber(null)
    setErrors({})
    setError(null)
    if (ch === 'email') setEmail(contactEmail)
    else setPhone(contactPhone)
  }
  const closeSend = () => {
    setChannel(null)
    setViber(null)
    setMessage('')
  }

  const send = (e: FormEvent, link: BuildingAccessLinkDto) => {
    e.preventDefault()
    if (!channel) return
    void run(async () => {
      const body =
        channel === 'email'
          ? { channel, email: email.trim(), message: message.trim() || undefined }
          : { channel, phone: phone.trim(), message: message.trim() || undefined }
      const r = await post<SendAccessLinkResultDto>(`${base}/${link.id}/send`, body)
      if (channel === 'email') {
        toast(t('accessLinks.sent', { to: email.trim() }))
        closeSend()
      } else {
        setViber(r.viber)
        toast(t('accessLinks.sent', { to: phone.trim() }))
      }
    })
  }

  const scopeLabel = (s: AccessLinkScope) => t(`accessLinks.scope.${s}`)

  return (
    <div className="card">
      <h2>{t('accessLinks.title')}</h2>
      <p className="muted small">{t('accessLinks.hint')}</p>

      {active ? (
        <div className="access-active">
          <div className="access-head">
            <Badge kind={accessLinkBadge(active.state)}>{t('accessLinks.active')}</Badge>
            <span className="muted small">{scopeLabel(active.scope)}</span>
          </div>
          <dl className="dl access-dl">
            <dt>{t('accessLinks.expiresAt')}</dt>
            <dd>{date(active.expiresAt)}</dd>
            <dt>{t('accessLinks.opensLabel')}</dt>
            <dd>{t('accessLinks.opens', { count: active.useCount })}</dd>
            <dt>{t('accessLinks.lastUsed')}</dt>
            <dd>
              {active.lastUsedAt ? (
                dateTime(active.lastUsedAt)
              ) : (
                <span className="muted">{t('accessLinks.neverUsed')}</span>
              )}
            </dd>
            <dt>{t('accessLinks.createdBy')}</dt>
            <dd>
              {active.createdByName ?? <span className="muted">{t('accessLinks.system')}</span>}{' '}
              <span className="muted small">· {date(active.createdAt)}</span>
            </dd>
          </dl>
          <Field label={t('accessLinks.url')}>
            <div className="access-url-row">
              <input
                type="text"
                readOnly
                value={active.url}
                className="access-url"
                onFocus={(e) => e.currentTarget.select()}
              />
              <button
                type="button"
                className="btn btn-small copy-btn"
                onClick={() => void copy(active.url)}
              >
                {t('accessLinks.copy')}
              </button>
            </div>
          </Field>
          <div className="actions access-actions">
            <a className="btn" href={active.viberUrl}>
              {t('accessLinks.viber')}
            </a>
            <button
              type="button"
              className={`btn${channel === 'email' ? ' btn-primary' : ''}`}
              disabled={busy}
              onClick={() => (channel === 'email' ? closeSend() : openSend('email'))}
            >
              {t('accessLinks.sendEmail')}
            </button>
            <button
              type="button"
              className={`btn${channel === 'viber' ? ' btn-primary' : ''}`}
              disabled={busy}
              onClick={() => (channel === 'viber' ? closeSend() : openSend('viber'))}
            >
              {t('accessLinks.sendViber')}
            </button>
            <ConfirmButton
              className="btn"
              label={t('accessLinks.rotate')}
              disabled={busy}
              onConfirm={() => rotate(active)}
            />
            <ConfirmButton
              label={t('accessLinks.revoke')}
              disabled={busy}
              onConfirm={() => revoke(active)}
            />
          </div>
          <p className="muted small">{t('accessLinks.rotateHint')}</p>

          {channel ? (
            <form className="inline-form" onSubmit={(e) => send(e, active)}>
              {channel === 'email' ? (
                <Field label={t('accessLinks.email')} required error={errors.email}>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </Field>
              ) : (
                <Field label={t('accessLinks.phone')} required error={errors.phone}>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                  />
                </Field>
              )}
              <Field label={t('accessLinks.message')} error={errors.message}>
                <textarea
                  rows={3}
                  value={message}
                  maxLength={1000}
                  onChange={(e) => setMessage(e.target.value)}
                />
              </Field>
              <div className="actions">
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {t('accessLinks.send')}
                </button>
                <button type="button" className="btn" disabled={busy} onClick={closeSend}>
                  {t('common.close')}
                </button>
              </div>
              {viber ? (
                <div className="viber-box">
                  <a className="btn btn-primary" href={viber.url}>
                    {t('notifications.viberOpen')}
                  </a>
                  <p className="muted small">{t('notifications.viberHowTo')}</p>
                </div>
              ) : null}
            </form>
          ) : null}
        </div>
      ) : (
        <div className="access-generate">
          <p className="muted">{t('accessLinks.noActive')}</p>
          <div className="row">
            <Field label={t('accessLinks.scope')} error={errors.scope}>
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value as AccessLinkScope)}
                disabled={busy}
              >
                {AccessLinkScopeEnum.options.map((s) => (
                  <option key={s} value={s}>
                    {scopeLabel(s)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('accessLinks.expiresInMonths')} error={errors.expiresInMonths}>
              <input
                type="number"
                min={1}
                max={60}
                value={months}
                onChange={(e) => setMonths(e.target.value)}
                disabled={busy}
              />
            </Field>
          </div>
          <div className="actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !(Number(months) >= 1 && Number(months) <= 60)}
              onClick={() => void generate()}
            >
              {t('accessLinks.generate')}
            </button>
          </div>
        </div>
      )}

      {history.length > 0 ? (
        <details className="access-history">
          <summary>
            {t('accessLinks.history')} <span className="count-pill">{history.length}</span>
          </summary>
          <ul className="list compact access-history-list">
            {history.map((l) => (
              <li key={l.id}>
                <span className="nowrap">{date(l.createdAt)}</span>
                <Badge kind={accessLinkBadge(l.state)}>{t(`accessLinks.${l.state}`)}</Badge>
                <span className="muted small">
                  {scopeLabel(l.scope)} · {t('accessLinks.opens', { count: l.useCount })}
                  {l.createdByName ? ` · ${l.createdByName}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  )
}
