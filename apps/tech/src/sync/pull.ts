import type { EntityTable, IDType } from 'dexie'
import type { CallbackEventPayload, CallbackStatus, SyncPullDto } from '@avroleva/contracts'
import type { CallbackRow, OutboxRow } from '../db'
import { db, setMeta, setMetaMany } from '../db'
import { getMeta } from '../db'
import { ApiError, platform } from '../platform'
import { hasSession } from '../app/session'
import { emitSync, errorText, nowIso, setClockOffsetMs } from './state'

const VISIT_RETENTION_DAYS = 90

let inflight: Promise<boolean> | null = null

/** GET /sync/pull since the stored watermark; single-flight. Resolves true on success. */
export function pull(): Promise<boolean> {
  if (inflight) return inflight
  inflight = doPull().finally(() => {
    inflight = null
  })
  return inflight
}

export function isPulling(): boolean {
  return inflight !== null
}

async function doPull(): Promise<boolean> {
  if (!hasSession()) return false
  if (await getMeta('needsReenroll')) return false
  emitSync('pull:start')
  try {
    const since = await getMeta('watermark')
    const query = since ? `?since=${encodeURIComponent(since)}` : ''
    const t0 = Date.now()
    const res = await platform.http.request<SyncPullDto>('GET', `/sync/pull${query}`, {
      timeoutMs: 120_000,
    })
    const t1 = Date.now()
    // offset = serverTime - clientTime at the request midpoint (ARCHITECTURE section 4, clock skew)
    const offsetMs = Math.round(Date.parse(res.data.serverTime) - (t0 + (t1 - t0) / 2))
    await applyPull(res.data, offsetMs)
    setClockOffsetMs(offsetMs)
    emitSync('pull:done')
    return true
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      await setMeta('needsReenroll', true)
      emitSync('unauthorized')
    }
    const text = errorText(err)
    await setMeta('lastPullError', text).catch(() => undefined)
    emitSync('pull:error', text)
    return false
  }
}

interface Tombstoned {
  id: string
  deletedAt: string | null
}

async function upsertRows<T extends Tombstoned>(
  table: EntityTable<T, 'id'>,
  rows: T[],
): Promise<void> {
  const dead = rows.filter((r) => r.deletedAt).map((r) => r.id as IDType<T, 'id'>)
  const live = rows.filter((r) => !r.deletedAt)
  if (dead.length) await table.bulkDelete(dead)
  if (live.length) await table.bulkPut(live)
}

const STATUS_RANK: Record<CallbackStatus, number> = {
  open: 0,
  dispatched: 1,
  on_site: 2,
  released: 3,
  restored: 4,
  closed: 5,
}

/** Keeps a status the phone already advanced (pending callback.event) ahead of the server copy. */
function applyOptimistic(row: CallbackRow, pending: OutboxRow[]): CallbackRow {
  let out = row
  for (const item of pending) {
    const p = item.payload as CallbackEventPayload
    if (p.callbackId !== row.id) continue
    if (STATUS_RANK[p.type] <= STATUS_RANK[out.status]) continue
    out = {
      ...out,
      status: p.type,
      onSiteAt: p.type === 'on_site' ? p.at : out.onSiteAt,
      releasedAt: p.type === 'released' ? p.at : out.releasedAt,
      restoredAt: p.type === 'restored' ? p.at : out.restoredAt,
    }
  }
  return out
}

async function applyPull(dto: SyncPullDto, offsetMs: number): Promise<void> {
  const unsent = await db.outbox.where('status').anyOf('pending', 'sending', 'failed').toArray()
  const pendingCallbackEvents = unsent
    .filter((i) => i.kind === 'callback.event')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const pendingDefectIds = new Set(
    unsent.filter((i) => i.kind === 'defect.record').map((i) => (i.payload as { id: string }).id),
  )
  const serverDefectIds = new Set(dto.defects.map((d) => d.id))
  const now = nowIso()
  const visitCutoff = new Date(Date.now() - VISIT_RETENTION_DAYS * 86_400_000).toISOString()

  await db.transaction(
    'rw',
    [
      db.buildings,
      db.elevators,
      db.contacts,
      db.users,
      db.checklistTemplates,
      db.defectCatalog,
      db.jobs,
      db.callbacks,
      db.defects,
      db.visits,
      db.meta,
    ],
    async () => {
      if (dto.full) {
        await db.buildings.clear()
        await db.elevators.clear()
        await db.contacts.clear()
      }
      await upsertRows(db.buildings, dto.buildings)
      await upsertRows(db.elevators, dto.elevators)
      await upsertRows(db.contacts, dto.contacts)

      await db.users.clear()
      await db.users.bulkPut(dto.users)
      await db.checklistTemplates.clear()
      await db.checklistTemplates.bulkPut(dto.checklistTemplates)
      await db.defectCatalog.clear()
      await db.defectCatalog.bulkPut(dto.defectCatalog)

      // Open work is a full replace: what the server no longer lists is gone.
      await db.jobs.clear()
      await db.jobs.bulkPut(dto.jobs)

      await db.callbacks.clear()
      await db.callbacks.bulkPut(
        dto.callbacks
          .filter((c) => c.status !== 'closed')
          .map((c) => applyOptimistic(c, pendingCallbackEvents)),
      )

      const keepLocalDefects = (await db.defects.filter((d) => d.local === true).toArray()).filter(
        (d) => pendingDefectIds.has(d.id) && !serverDefectIds.has(d.id),
      )
      await db.defects.clear()
      await db.defects.bulkPut([
        ...dto.defects.filter((d) => d.status !== 'resolved'),
        ...keepLocalDefects,
      ])

      // Server visits overwrite the local pending copies with the same id (drops `local`).
      if (dto.visits.length) await db.visits.bulkPut(dto.visits)
      await db.visits
        .where('startedAt')
        .below(visitCutoff)
        .and((v) => v.local !== true)
        .delete()

      await setMetaMany({
        watermark: dto.watermark,
        clockOffsetMs: offsetMs,
        clockMeasuredAt: now,
        lastPullAt: now,
        lastPullError: null,
        user: dto.me,
        tenant: dto.tenant,
      })
    },
  )
}
