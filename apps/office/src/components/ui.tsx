import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { ApiError } from '../lib/api'
import { useI18n } from '../i18n/I18nProvider'

export function Spinner() {
  const { t } = useI18n()
  return (
    <div className="muted" role="status">
      {t('common.loading')}
    </div>
  )
}

export function ErrorBox({ error }: { error: unknown }) {
  const { t } = useI18n()
  if (!error) return null
  const msg =
    error instanceof ApiError
      ? error.problem.title
      : error instanceof Error
        ? error.message
        : t('error.internal')
  return (
    <div className="alert alert-error" role="alert">
      {msg}
    </div>
  )
}

export function Empty({ text }: { text?: string }) {
  const { t } = useI18n()
  return <div className="empty">{text ?? t('common.empty')}</div>
}

export function PageHeader({
  title,
  subtitle,
  actions,
  back,
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  back?: ReactNode
}) {
  return (
    <div className="page-header">
      <div>
        {back}
        <h1>{title}</h1>
        {subtitle ? <div className="page-subtitle muted">{subtitle}</div> : null}
      </div>
      {actions ? <div className="actions">{actions}</div> : null}
    </div>
  )
}

export function Field({
  label,
  error,
  children,
  hint,
  required,
}: {
  label: string
  error?: string
  hint?: string
  required?: boolean
  children: ReactNode
}) {
  return (
    <label className={`field${error ? ' has-error' : ''}`}>
      <span className="field-label">
        {label}
        {required ? <span className="req"> *</span> : null}
      </span>
      {children}
      {error ? (
        <span className="field-error">{error}</span>
      ) : hint ? (
        <span className="field-hint">{hint}</span>
      ) : null}
    </label>
  )
}

export function Badge({
  kind,
  children,
}: {
  kind?: 'ok' | 'warn' | 'danger' | 'muted' | 'info'
  children: ReactNode
}) {
  return <span className={`badge badge-${kind ?? 'muted'}`}>{children}</span>
}

export function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  const { t } = useI18n()
  const [local, setLocal] = useState(value)
  useEffect(() => setLocal(value), [value])
  useEffect(() => {
    const h = setTimeout(() => {
      if (local !== value) onChange(local)
    }, 300)
    return () => clearTimeout(h)
  }, [local, value, onChange])
  return (
    <input
      className="search"
      type="search"
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      placeholder={placeholder ?? t('common.search')}
    />
  )
}

export function ConfirmButton({
  onConfirm,
  label,
  confirmLabel,
  className,
  disabled,
}: {
  onConfirm: () => void | Promise<void>
  label: string
  confirmLabel?: string
  className?: string
  disabled?: boolean
}) {
  const { t } = useI18n()
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!armed) return
    const h = setTimeout(() => setArmed(false), 4000)
    return () => clearTimeout(h)
  }, [armed])
  if (!armed)
    return (
      <button
        type="button"
        className={className ?? 'btn btn-danger-outline'}
        disabled={disabled}
        onClick={() => setArmed(true)}
      >
        {label}
      </button>
    )
  return (
    <span className="confirm-group">
      <button
        type="button"
        className="btn btn-danger"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          try {
            await onConfirm()
          } finally {
            setBusy(false)
            setArmed(false)
          }
        }}
      >
        {confirmLabel ?? t('common.confirm')}
      </button>
      <button type="button" className="btn" onClick={() => setArmed(false)}>
        {t('common.cancel')}
      </button>
    </span>
  )
}

/** Toast: single global message via a tiny event bus. */
const TOAST_EVENT = 'avroleva:toast'
export function toast(message: string, kind: 'ok' | 'error' = 'ok') {
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: { message, kind } }))
}

export function ToastHost() {
  const [item, setItem] = useState<{ message: string; kind: 'ok' | 'error' } | null>(null)
  useEffect(() => {
    const on = (e: Event) => setItem((e as CustomEvent).detail)
    window.addEventListener(TOAST_EVENT, on)
    return () => window.removeEventListener(TOAST_EVENT, on)
  }, [])
  useEffect(() => {
    if (!item) return
    const h = setTimeout(() => setItem(null), 3500)
    return () => clearTimeout(h)
  }, [item])
  if (!item) return null
  return (
    <div className={`toast toast-${item.kind}`} role="status">
      {item.message}
    </div>
  )
}

/** Generic "load more" cursor list state. */
export function useCursorList<T>(
  fetchPage: (cursor: string | null) => Promise<{ items: T[]; nextCursor: string | null }>,
  deps: unknown[],
) {
  const [items, setItems] = useState<T[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchPage(null)
      .then((p) => {
        if (cancelled) return
        setItems(p.items)
        setCursor(p.nextCursor)
      })
      .catch((e) => !cancelled && setError(e))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version])

  const loadMore = async () => {
    if (!cursor) return
    setLoading(true)
    try {
      const p = await fetchPage(cursor)
      setItems((prev) => [...prev, ...p.items])
      setCursor(p.nextCursor)
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }
  return {
    items,
    loading,
    error,
    hasMore: !!cursor,
    loadMore,
    reload: () => setVersion((v) => v + 1),
    setItems,
  }
}

export function LoadMore({
  hasMore,
  loading,
  onClick,
}: {
  hasMore: boolean
  loading: boolean
  onClick: () => void
}) {
  const { t } = useI18n()
  if (!hasMore) return null
  return (
    <div className="load-more">
      <button type="button" className="btn" disabled={loading} onClick={onClick}>
        {t('common.loadMore')}
      </button>
    </div>
  )
}
