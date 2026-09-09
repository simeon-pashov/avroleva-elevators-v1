import type { ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { useT } from '../i18n/I18nProvider'

export function PageHeader({
  title,
  back,
  right,
  subtitle,
}: {
  title: string
  back?: boolean
  right?: ReactNode
  subtitle?: ReactNode
}) {
  const t = useT()
  const navigate = useNavigate()
  return (
    <header className="topbar">
      <div className="topbar-row">
        {back ? (
          <button
            type="button"
            className="btn btn-icon"
            aria-label={t('tech.common.back')}
            onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}
          >
            ‹
          </button>
        ) : null}
        <h1 className="topbar-title">{title}</h1>
        {right ? <div className="topbar-right">{right}</div> : null}
      </div>
      {subtitle ? <div className="topbar-sub">{subtitle}</div> : null}
    </header>
  )
}

export function Spinner({ inline }: { inline?: boolean }) {
  const t = useT()
  return (
    <span className={inline ? 'spinner spinner-inline' : 'spinner'} role="status">
      <span className="spinner-dot" aria-hidden="true" />
      {inline ? null : <span className="muted">{t('common.loading')}</span>}
    </span>
  )
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="section">
      <h2 className="section-title">{title}</h2>
      {children}
    </section>
  )
}

export function Empty({ text }: { text: string }) {
  return <p className="empty muted">{text}</p>
}

export function TelLink({
  phone,
  label,
  small,
}: {
  phone: string | null | undefined
  label?: string
  small?: boolean
}) {
  const t = useT()
  if (!phone) return null
  return (
    <a
      className={`btn btn-outline${small ? ' btn-sm' : ''}`}
      href={`tel:${phone.replace(/[^+0-9]/g, '')}`}
    >
      {label ?? t('tech.today.call')}
      <span className="btn-detail">{phone}</span>
    </a>
  )
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string
  children: ReactNode
  hint?: string
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint muted">{hint}</span> : null}
    </label>
  )
}

export function StatusPill({
  tone,
  text,
}: {
  tone: 'ok' | 'warn' | 'danger' | 'muted'
  text: string
}) {
  return <span className={`pill pill-${tone}`}>{text}</span>
}
