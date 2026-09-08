import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useApp } from '../app/AppProvider'
import { Empty, PageHeader, Spinner, StatusPill } from '../components/ui'
import type { OutboxRow } from '../db'
import { db } from '../db'
import { useI18n } from '../i18n/I18nProvider'
import { CLOCK_SUSPECT_MS, retryItem } from '../sync'

const TONE: Record<OutboxRow['status'], 'ok' | 'warn' | 'danger' | 'muted'> = {
  pending: 'warn',
  sending: 'warn',
  failed: 'danger',
  done: 'ok',
}

export function OutboxPage() {
  const { t, dateTime } = useI18n()
  const app = useApp()
  const items = useLiveQuery(() => db.outbox.orderBy('createdAt').reverse().toArray(), [])
  const elevators = useLiveQuery(() => db.elevators.toArray(), [])
  const buildings = useLiveQuery(() => db.buildings.toArray(), [])

  const addressOf = useMemo(() => {
    const bById = new Map((buildings ?? []).map((b) => [b.id, b]))
    const eById = new Map((elevators ?? []).map((e) => [e.id, e]))
    return (elevatorId: string | undefined): string => {
      if (!elevatorId) return ''
      const e = eById.get(elevatorId)
      if (!e) return ''
      const b = bById.get(e.buildingId)
      return b ? `${b.addressText} · ${e.internalNo}` : e.internalNo
    }
  }, [buildings, elevators])

  const offset = app.meta.clockOffsetMs ?? 0
  const offsetSuspect =
    app.meta.clockMeasuredAt !== undefined && Math.abs(offset) > CLOCK_SUSPECT_MS
  const offsetSeconds = Math.round(offset / 1000)
  const offsetText = `${offsetSeconds < 0 ? '−' : '+'}${Math.abs(offsetSeconds)} s`

  return (
    <>
      <PageHeader
        title={t('tech.outbox.title')}
        subtitle={t('tech.outbox.pending', { count: app.pendingCount })}
        right={
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={app.pulling || !app.online}
            onClick={() => void app.syncNow()}
          >
            {t('tech.outbox.syncNow')}
          </button>
        }
      />
      <div className="page">
        <div className="card">
          <dl className="kv">
            <dt>{t('tech.outbox.lastPull')}</dt>
            <dd>{app.meta.lastPullAt ? dateTime(app.meta.lastPullAt) : t('tech.today.never')}</dd>
            <dt>{t('tech.outbox.lastSync')}</dt>
            <dd>{app.meta.lastPushAt ? dateTime(app.meta.lastPushAt) : t('tech.today.never')}</dd>
            <dt>{t('tech.outbox.clockOffset')}</dt>
            <dd>{app.meta.clockMeasuredAt ? offsetText : '—'}</dd>
          </dl>
          {offsetSuspect ? (
            <div className="banner banner-danger">{t('tech.outbox.clockSuspect')}</div>
          ) : null}
          {app.photosPending ? (
            <div className="muted small">
              {t('tech.outbox.photosPending', { count: app.photosPending })}
            </div>
          ) : null}
        </div>

        {items === undefined ? (
          <Spinner />
        ) : items.length === 0 ? (
          <Empty text={t('tech.outbox.empty')} />
        ) : (
          <div className="list">
            {items.map((it) => (
              <div key={it.id} className="row">
                <div className="row-main">
                  <span className="row-title">
                    {t(`tech.outbox.kind.${it.kind}`)}
                    {addressOf(it.elevatorId) ? ` · ${addressOf(it.elevatorId)}` : ''}
                  </span>
                  <span className="row-sub">
                    {dateTime(it.createdAt)}
                    {it.attempts ? ` · ${t('tech.outbox.attempts', { count: it.attempts })}` : ''}
                  </span>
                  {it.lastError && it.status !== 'done' ? (
                    <span className="row-sub danger">{`${t('tech.outbox.error')}: ${it.lastError}`}</span>
                  ) : null}
                </div>
                <StatusPill tone={TONE[it.status]} text={t(`tech.outbox.status.${it.status}`)} />
                {it.status === 'failed' ? (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => void retryItem(it.id)}
                  >
                    {t('tech.outbox.retry')}
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
