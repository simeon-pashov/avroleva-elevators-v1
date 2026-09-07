import { useState } from 'react'
import type { ContactDto, ContactRole } from '@avroleva/contracts'
import { ContactRole as ContactRoleEnum } from '@avroleva/contracts'
import { del, patch, post } from '../../lib/api'
import { useI18n } from '../../i18n/I18nProvider'
import { ConfirmButton, ErrorBox, Field, toast } from '../../components/ui'
import { EnumSelect } from '../../components/EnumSelect'
import { useForm } from '../../components/useForm'

interface ContactForm {
  name: string
  role: ContactRole
  phone: string
  hasViber: boolean
  email: string
  isPrimary: boolean
  notes: string
}

const empty: ContactForm = {
  name: '',
  role: 'house_manager',
  phone: '',
  hasViber: false,
  email: '',
  isPrimary: false,
  notes: '',
}

/** Contacts of a building or a customer, with inline add/edit. */
export function ContactsPanel({
  contacts,
  parent,
  onChange,
  canEdit,
}: {
  contacts: ContactDto[]
  parent: { buildingId?: string | null; customerId?: string | null }
  onChange: () => Promise<void> | void
  canEdit: boolean
}) {
  const { t } = useI18n()
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const form = useForm<ContactForm>(empty)

  const startEdit = (c?: ContactDto) => {
    form.setValues(
      c
        ? {
            name: c.name,
            role: c.role,
            phone: c.phone ?? '',
            hasViber: c.hasViber,
            email: c.email ?? '',
            isPrimary: c.isPrimary,
            notes: c.notes ?? '',
          }
        : empty,
    )
    setEditing(c ? c.id : 'new')
  }

  const save = () =>
    form.submit(async (v) => {
      const body = {
        ...v,
        ...(editing === 'new'
          ? { buildingId: parent.buildingId ?? null, customerId: parent.customerId ?? null }
          : {}),
      }
      if (editing === 'new') await post('/contacts', body)
      else await patch(`/contacts/${editing}`, body)
      toast(t('common.saved'))
      setEditing(null)
      await onChange()
    })

  return (
    <div className="card">
      <div className="card-head">
        <h2>{t('contacts.title')}</h2>
        {canEdit && editing === null ? (
          <button type="button" className="btn btn-small" onClick={() => startEdit()}>
            {t('contacts.new')}
          </button>
        ) : null}
      </div>
      {contacts.length === 0 && editing === null ? (
        <p className="muted">{t('contacts.none')}</p>
      ) : null}
      <ul className="list">
        {contacts.map((c) => (
          <li key={c.id} className="contact-row">
            <div>
              <strong>{c.name}</strong>{' '}
              <span className="muted">· {t(`enum.contactRole.${c.role}`)}</span>
              {c.isPrimary ? (
                <span className="badge badge-info">{t('contacts.primary')}</span>
              ) : null}
              <div className="small">
                {c.phone ? (
                  <a href={`tel:${c.phone}`}>{c.phone}</a>
                ) : (
                  <span className="muted">{t('contacts.noPhone')}</span>
                )}
                {c.hasViber ? <span className="muted">{' · Viber'}</span> : null}
                {c.email ? (
                  <>
                    {' · '}
                    <a href={`mailto:${c.email}`}>{c.email}</a>
                  </>
                ) : null}
              </div>
            </div>
            {canEdit ? (
              <div className="actions">
                <button type="button" className="btn btn-small" onClick={() => startEdit(c)}>
                  {t('common.edit')}
                </button>
                <ConfirmButton
                  className="btn btn-small btn-danger-outline"
                  label={t('common.archive')}
                  onConfirm={async () => {
                    await del(`/contacts/${c.id}`)
                    await onChange()
                  }}
                />
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {editing !== null ? (
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <div className="row">
            <Field label={t('contacts.name')} required error={form.errors.name}>
              <input value={form.values.name} onChange={(e) => form.set('name', e.target.value)} />
            </Field>
            <Field label={t('contacts.role')} error={form.errors.role}>
              <EnumSelect
                value={form.values.role}
                options={ContactRoleEnum.options}
                prefix="enum.contactRole"
                onChange={(x) => x && form.set('role', x)}
              />
            </Field>
          </div>
          <div className="row">
            <Field label={t('contacts.phone')} error={form.errors.phone}>
              <input
                value={form.values.phone}
                onChange={(e) => form.set('phone', e.target.value)}
              />
            </Field>
            <Field label={t('contacts.email')} error={form.errors.email}>
              <input
                type="email"
                value={form.values.email}
                onChange={(e) => form.set('email', e.target.value)}
              />
            </Field>
          </div>
          <div className="row checks">
            <label className="check">
              <input
                type="checkbox"
                checked={form.values.hasViber}
                onChange={(e) => form.set('hasViber', e.target.checked)}
              />{' '}
              {t('contacts.hasViber')}
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={form.values.isPrimary}
                onChange={(e) => form.set('isPrimary', e.target.checked)}
              />{' '}
              {t('contacts.isPrimary')}
            </label>
          </div>
          <ErrorBox error={form.error} />
          <div className="actions">
            <button type="submit" className="btn btn-primary btn-small" disabled={form.busy}>
              {t('common.save')}
            </button>
            <button type="button" className="btn btn-small" onClick={() => setEditing(null)}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  )
}
