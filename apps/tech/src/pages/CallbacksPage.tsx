import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { CallbackEventPayload, CallbackStatus } from '@avroleva/contracts'
import { useToast } from '../components/Toast'
import { Empty, PageHeader, Spinner, StatusPill, TelLink } from '../components/ui'
import type { CallbackRow } from '../db'
import { db } from '../db'
import { useI18n } from '../i18n/I18nProvider'
import { buildOutboxRow, deviceTime, requestDrain } from '../sync'

type EventType = CallbackEventPayload['type']

const ACTIONS: Array<{ type: EventType; label: string; from: CallbackStatus[] }> = [
  { type: 'on_site', label: 'tech.callbacks.onSite', from: ['open', 'dispatched'] },
  { type: 'released', label: 'tech.callbacks.released', from: ['on_site'] },
  { type: 'restored', label: 'tech.callbacks.restored', from: ['on_site', 'released'] },
]

function CallbackCard({
  cb,
  onEvent,
}: {
  cb: CallbackRow
  onEvent: (cb: CallbackRow, type: EventType, note: string) => Promise<void>
}) {
  const { t, dateTime } = useI18n()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const trapped = cb.classification === 'trapped_persons'
  return (
    <div className="card">
      <div className="card-title">{cb.buildingAddressText}</div>
      <div className="inline">
        <span className="strong">{`${t('callbacks.elevator')} ${cb.elevatorInternalNo}`}</span>
        <StatusPill
          tone={trapped ? 'danger' : 'warn'}
          text={t(`enum.callbackClassification.${cb.classification}`)}
        />
        {cb.trappedCount ? (
          <StatusPill
            tone="danger"
            text={t('tech.callbacks.trapped', { count: cb.trappedCount })}
          />
        ) : null}
        <StatusPill tone="muted" text={t(`enum.callbackStatus.${cb.status}`)} />
      </div>
      <p>{cb.description}</p>
      <div className="muted small">
        {t('tech.callbacks.received', { at: dateTime(cb.receivedAt) })}
      </div>
      {cb.callerName || cb.callerPhone ? (
        <div className="small">
          <span className="muted">{`${t('tech.callbacks.caller')}: `}</span>
          {cb.callerName ?? ''}
        </div>
      ) : null}
      {cb.callerPhone ? <TelLink phone={cb.callerPhone} /> : null}
      <input
        type="text"
        placeholder={t('tech.callbacks.note')}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={2000}
      />
      <div className="card-actions">
        {ACTIONS.map((a) => (
          <button
            key={a.type}
            type="button"
            className="btn btn-primary"
            disabled={busy || !a.from.includes(cb.status)}
            onClick={() => {
              setBusy(true)
              void onEvent(cb, a.type, note)
                .then(() => setNote(''))
                .finally(() => setBusy(false))
            }}
          >
            {t(a.label)}
          </button>
        ))}
      </div>
      <div className="muted small">{t('tech.callbacks.closeInOffice')}</div>
    </div>
  )
}

export function CallbacksPage() {
  const { t } = useI18n()
  const toast = useToast()
  const callbacks = useLiveQuery(
    () =>
      db.callbacks
        .filter((c) => c.status !== 'closed')
        .toArray()
        .then((rows) => rows.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))),
    [],
  )

  async function onEvent(cb: CallbackRow, type: EventType, note: string) {
    const dt = deviceTime()
    const payload: CallbackEventPayload = {
      callbackId: cb.id,
      type,
      at: dt.at,
      clientOffsetMs: dt.clientOffsetMs,
      timestampSource: 'device',
      notes: note.trim() || null,
    }
    // Optimistic: the buttons progress offline; the server copy replaces this on push/pull.
    await db.transaction('rw', [db.callbacks, db.outbox], async () => {
      await db.outbox.add(
        buildOutboxRow({ kind: 'callback.event', payload, elevatorId: cb.elevatorId }),
      )
      await db.callbacks.update(cb.id, {
        status: type,
        onSiteAt: type === 'on_site' ? dt.at : cb.onSiteAt,
        releasedAt: type === 'released' ? dt.at : cb.releasedAt,
        restoredAt: type === 'restored' ? dt.at : cb.restoredAt,
      })
    })
    void requestDrain()
    toast.show(t('tech.callbacks.done'))
  }

  return (
    <>
      <PageHeader title={t('tech.callbacks.title')} />
      <div className="page">
        {callbacks === undefined ? (
          <Spinner />
        ) : callbacks.length === 0 ? (
          <Empty text={t('tech.callbacks.empty')} />
        ) : (
          callbacks.map((cb) => <CallbackCard key={cb.id} cb={cb} onEvent={onEvent} />)
        )}
      </div>
    </>
  )
}
