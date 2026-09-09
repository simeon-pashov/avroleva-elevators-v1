import type {
  AttachmentDto,
  CallbackDto,
  DefectDto,
  JobDto,
  SyncPushItem,
  SyncPushResultDto,
  VisitDto,
} from '@avroleva/contracts'
import type { AttachmentUploadPayload, OutboxKind, OutboxRow } from '../db'
import { db, getMeta, setMeta } from '../db'
import { uuidv7 } from '../lib/ids'
import { ApiError, NetworkError, platform } from '../platform'
import { pull } from './pull'
import { emitSync, errorText, nowIso } from './state'

const BACKOFF_MIN_MS = 5_000
const BACKOFF_MAX_MS = 5 * 60_000
const DONE_RETENTION_MS = 24 * 60 * 60_000

export interface EnqueueInput {
  kind: OutboxKind
  payload: unknown
  visitId?: string
  elevatorId?: string
}

/** Builds a pending row; the caller adds it inside its own transaction (visit + blobs + outbox). */
export function buildOutboxRow(input: EnqueueInput): OutboxRow {
  return {
    id: uuidv7(),
    kind: input.kind,
    schemaVersion: 1,
    payload: input.payload,
    createdAt: nowIso(),
    attempts: 0,
    lastError: null,
    status: 'pending',
    nextAttemptAt: null,
    visitId: input.visitId,
    elevatorId: input.elevatorId,
  }
}

export async function enqueue(inputs: EnqueueInput[]): Promise<OutboxRow[]> {
  const rows = inputs.map(buildOutboxRow)
  await db.outbox.bulkAdd(rows)
  return rows
}

export function backoffMs(attempts: number): number {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** Math.max(0, attempts - 1))
}

/** Failed item back to the queue (Outbox screen "Опитай пак"). */
export async function retryItem(id: string): Promise<void> {
  await db.outbox.update(id, { status: 'pending', nextAttemptAt: null, lastError: null })
  void requestDrain()
}

/** Drain now, and ask the SW to wake us up later (Background Sync, Android Chrome). */
export async function requestDrain(): Promise<void> {
  void drain()
  try {
    if (!('serviceWorker' in navigator)) return
    const reg = await navigator.serviceWorker.getRegistration()
    const sync = (reg as unknown as { sync?: { register(tag: string): Promise<void> } } | undefined)
      ?.sync
    await sync?.register('outbox')
  } catch {
    /* no background sync here */
  }
}

let inflight: Promise<void> | null = null
let timer: ReturnType<typeof setTimeout> | undefined

export function isDraining(): boolean {
  return inflight !== null
}

/** Strictly FIFO, one request at a time, one in-flight drain at a time. */
export function drain(): Promise<void> {
  if (inflight) return inflight
  inflight = run().finally(() => {
    inflight = null
  })
  return inflight
}

function scheduleDrain(delayMs: number): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = undefined
    void drain()
  }, delayMs)
}

async function nextPending(): Promise<OutboxRow | undefined> {
  const rows = await db.outbox.where('status').equals('pending').toArray()
  rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  return rows[0]
}

type Outcome = 'unauthorized' | 'permanent' | 'retry'

function classify(err: unknown): Outcome {
  if (err instanceof ApiError) {
    if (err.status === 401) return 'unauthorized'
    if (err.status === 408 || err.status === 429 || err.status >= 500) return 'retry'
    return 'permanent'
  }
  if (err instanceof NetworkError) return 'retry'
  return 'permanent'
}

async function run(): Promise<void> {
  // A page closed mid-request leaves "sending" behind; nothing else is in flight now.
  await db.outbox.where('status').equals('sending').modify({ status: 'pending' })
  await db.outbox
    .where('status')
    .equals('done')
    .and((r) => !!r.doneAt && Date.parse(r.doneAt) < Date.now() - DONE_RETENTION_MS)
    .delete()

  let sentAny = false
  for (;;) {
    if (navigator.onLine === false) break
    if (await getMeta('needsReenroll')) break
    const item = await nextPending()
    if (!item) break
    if (item.nextAttemptAt && Date.parse(item.nextAttemptAt) > Date.now()) {
      scheduleDrain(Date.parse(item.nextAttemptAt) - Date.now())
      break
    }
    await db.outbox.update(item.id, { status: 'sending' })
    emitSync('push:start', item.id)
    try {
      await sendItem(item)
      await db.outbox.update(item.id, { status: 'done', doneAt: nowIso(), lastError: null })
      sentAny = true
    } catch (err) {
      const outcome = classify(err)
      const attempts = item.attempts + 1
      const lastError = errorText(err)
      if (outcome === 'unauthorized') {
        await db.outbox.update(item.id, { status: 'pending', attempts, lastError })
        await setMeta('needsReenroll', true)
        emitSync('unauthorized')
        break
      }
      if (outcome === 'permanent') {
        await db.outbox.update(item.id, { status: 'failed', attempts, lastError })
        emitSync('push:error', lastError)
        continue
      }
      const delay = backoffMs(attempts)
      await db.outbox.update(item.id, {
        status: 'pending',
        attempts,
        lastError,
        nextAttemptAt: new Date(Date.now() + delay).toISOString(),
      })
      emitSync('push:error', lastError)
      scheduleDrain(delay)
      break
    }
  }
  if (sentAny) {
    await setMeta('lastPushAt', nowIso())
    emitSync('push:done')
    void pull()
  }
}

async function sendItem(item: OutboxRow): Promise<void> {
  if (item.kind === 'attachment.upload') return sendUpload(item)
  return sendPush(item)
}

async function sendPush(item: OutboxRow): Promise<void> {
  const body: SyncPushItem = {
    id: item.id,
    kind: item.kind,
    schemaVersion: item.schemaVersion,
    createdAt: item.createdAt,
    payload: item.payload,
  } as SyncPushItem
  const res = await platform.http.request<SyncPushResultDto>('POST', '/sync/push', {
    body,
    headers: { 'Idempotency-Key': item.id },
    timeoutMs: 60_000,
  })
  const result = res.data.result
  // Reflect the server copy right away (the next pull would do the same).
  switch (item.kind) {
    case 'visit.record':
      await db.visits.put(result as VisitDto)
      break
    case 'defect.record': {
      const d = result as DefectDto
      if (d.status === 'resolved') await db.defects.delete(d.id)
      else await db.defects.put(d)
      break
    }
    case 'callback.event': {
      const c = result as CallbackDto
      if (c.status === 'closed') await db.callbacks.delete(c.id)
      else await db.callbacks.put(c)
      break
    }
    case 'job.event': {
      const j = result as JobDto
      // Done / invoiced jobs leave the phone (the next pull would drop them too).
      if (j.isTerminal || j.status === 'done') await db.repairJobs.delete(j.id)
      else await db.repairJobs.put(j)
      break
    }
    default:
      break
  }
}

class HashMismatch extends Error {
  constructor() {
    super('attachments.hashMismatch')
  }
}

async function sendUpload(item: OutboxRow): Promise<void> {
  const p = item.payload as AttachmentUploadPayload
  const row = await db.blobs.get(p.attachmentId)
  if (!row) return // already uploaded (confirmed) or lost with the storage: nothing to send
  const form = new FormData()
  form.set('id', p.attachmentId)
  form.set('sha256', row.sha256)
  form.set('kind', 'photo')
  form.set('takenAt', p.takenAt)
  form.set('file', row.blob, `${p.attachmentId}.jpg`)
  const res = await platform.http.request<AttachmentDto>('POST', '/attachments', {
    form,
    timeoutMs: 180_000,
  })
  const dto = res.data
  if (dto.sha256.toLowerCase() !== row.sha256.toLowerCase()) throw new HashMismatch()
  await db.transaction('rw', [db.blobs, db.visits], async () => {
    await db.blobs.delete(p.attachmentId)
    const visit = await db.visits.get(p.visitId)
    if (visit) {
      await db.visits.put({
        ...visit,
        attachments: visit.attachments.map((a) =>
          a.attachmentId === p.attachmentId ? { ...a, uploaded: true, attachment: dto } : a,
        ),
      })
    }
  })
}
