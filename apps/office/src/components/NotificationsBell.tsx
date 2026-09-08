import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import type { InboxDto, NotificationDto } from '@avroleva/contracts'
import { get, post } from '../lib/api'
import { useI18n } from '../i18n/I18nProvider'
import { useAuth } from '../auth/AuthProvider'

const POLL_MS = 60_000
const LIMIT = 30

/** "преди 5 минути" / "yesterday" for the last week, else the short date. */
function relativeTime(iso: string, locale: string, fallback: (d: string) => string): string {
  const diffSec = Math.round((new Date(iso).getTime() - Date.now()) / 1000)
  const abs = Math.abs(diffSec)
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  if (abs < 60) return rtf.format(Math.trunc(diffSec), 'second')
  if (abs < 3600) return rtf.format(Math.trunc(diffSec / 60), 'minute')
  if (abs < 86_400) return rtf.format(Math.trunc(diffSec / 3600), 'hour')
  if (abs < 7 * 86_400) return rtf.format(Math.trunc(diffSec / 86_400), 'day')
  return fallback(iso)
}

const excerpt = (body: string, max = 120) => {
  const line = body.split('\n').find((l) => l.trim() !== '') ?? ''
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

/**
 * Bell in the top bar: unread badge, polling every minute (and on focus), a dropdown with the
 * latest in-app notifications. Clicking one marks it read and follows its office link.
 */
export function NotificationsBell() {
  const { t, locale, date } = useI18n()
  const { hasRole } = useAuth()
  const navigate = useNavigate()
  const [inbox, setInbox] = useState<InboxDto | null>(null)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    try {
      setInbox(await get<InboxDto>(`/notifications/inbox?limit=${LIMIT}`))
    } catch {
      /* keep the last known inbox; a 401 is handled by the shell */
    }
  }, [])

  useEffect(() => {
    void load()
    const h = setInterval(() => void load(), POLL_MS)
    const onFocus = () => void load()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(h)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load])

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const markRead = async (ids?: string[]) => {
    const now = new Date().toISOString()
    setInbox((cur) =>
      cur
        ? {
            unread: ids ? Math.max(0, cur.unread - ids.length) : 0,
            items: cur.items.map((n) =>
              n.readAt || (ids && !ids.includes(n.id)) ? n : { ...n, readAt: now },
            ),
          }
        : cur,
    )
    try {
      await post('/notifications/inbox/read', ids ? { ids } : {})
    } finally {
      void load()
    }
  }

  const openItem = (n: NotificationDto) => {
    setOpen(false)
    if (!n.readAt) void markRead([n.id])
    if (!n.link) return
    if (/^https?:/i.test(n.link)) window.location.assign(n.link)
    else navigate(n.link)
  }

  const unread = inbox?.unread ?? 0
  const items = inbox?.items ?? []

  return (
    <div className="bell" ref={rootRef}>
      <button
        type="button"
        className={`bell-btn${unread > 0 ? ' has-unread' : ''}`}
        aria-label={t('bell.title')}
        aria-expanded={open}
        title={t('bell.unread', { count: unread })}
        onClick={() => {
          setOpen((v) => !v)
          if (!open) void load()
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="currentColor"
            d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2Z"
          />
        </svg>
        {unread > 0 ? <span className="bell-badge">{unread > 99 ? '99+' : unread}</span> : null}
      </button>
      {open ? (
        <div className="bell-menu" role="dialog" aria-label={t('bell.title')}>
          <div className="bell-head">
            <strong>{t('bell.title')}</strong>
            <span className="muted small">{t('bell.unread', { count: unread })}</span>
            {unread > 0 ? (
              <button type="button" className="linkish small" onClick={() => void markRead()}>
                {t('bell.markAll')}
              </button>
            ) : null}
          </div>
          {items.length === 0 ? (
            <div className="bell-empty muted small">{t('bell.empty')}</div>
          ) : (
            <ul className="bell-list">
              {items.map((n) => (
                <li key={n.id} className={n.readAt ? '' : 'unread'}>
                  <button type="button" className="bell-item" onClick={() => openItem(n)}>
                    <span className="bell-subject">{n.subject ?? excerpt(n.body, 80)}</span>
                    {n.subject ? <span className="bell-body muted">{excerpt(n.body)}</span> : null}
                    <span className="bell-time muted small">
                      {relativeTime(n.createdAt, locale, date)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {hasRole('owner', 'office') ? (
            <div className="bell-foot">
              <Link to="/notifications" onClick={() => setOpen(false)}>
                {t('bell.all')}
              </Link>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
