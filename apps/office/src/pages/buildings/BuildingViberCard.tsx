import { useState } from 'react'
import type { BuildingDetailDto, ContactDto, ViberLinkDto } from '@avroleva/contracts'
import { post } from '../../lib/api'
import { useI18n } from '../../i18n/I18nProvider'
import { useAuth } from '../../auth/AuthProvider'
import { ErrorBox, Field } from '../../components/ui'
import { ViberLinks } from '../../components/ViberLinks'

/**
 * "Изпрати по Viber": pick a contact with a phone, edit the prefilled greeting, build the deep
 * links (nothing is stored - the office user sends the message from Viber by hand).
 */
export function BuildingViberCard({ building }: { building: BuildingDetailDto }) {
  const { t } = useI18n()
  const { me } = useAuth()
  const [contact, setContact] = useState<ContactDto | null>(null)
  const [text, setText] = useState('')
  const [links, setLinks] = useState<ViberLinkDto | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const withPhone = building.contacts.filter((c) => !!c.phone)

  const start = (c: ContactDto) => {
    setContact(c)
    setLinks(null)
    setError(null)
    setText(
      t('buildings.viberGreeting', {
        name: c.name,
        tenant: me?.tenant.name ?? '',
        address: building.addressText,
      }),
    )
  }

  const build = async () => {
    if (!contact?.phone) return
    setBusy(true)
    setError(null)
    try {
      setLinks(
        await post<ViberLinkDto>('/notifications/viber-link', { phone: contact.phone, text }),
      )
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <h2>{t('buildings.viberTitle')}</h2>
      <p className="muted small">{t('buildings.viberHint')}</p>
      {withPhone.length === 0 ? (
        <p className="muted">{t('buildings.viberNoContacts')}</p>
      ) : (
        <ul className="list compact">
          {withPhone.map((c) => (
            <li key={c.id} className="contact-row">
              <span>
                {c.name} <span className="muted small">{c.phone}</span>
              </span>
              <button
                type="button"
                className={`btn btn-small${contact?.id === c.id ? ' btn-primary' : ''}`}
                onClick={() => start(c)}
              >
                {t('buildings.viberTitle')}
              </button>
            </li>
          ))}
        </ul>
      )}
      {contact ? (
        <div className="inline-form">
          <Field label={t('buildings.viberText')}>
            <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          <ErrorBox error={error} />
          <div className="actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || text.trim() === ''}
              onClick={build}
            >
              {t('buildings.viberBuild')}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setContact(null)
                setLinks(null)
              }}
            >
              {t('common.close')}
            </button>
          </div>
          {links ? <ViberLinks viber={links} /> : null}
        </div>
      ) : null}
    </div>
  )
}
