import Dexie from 'dexie'
import type { EntityTable } from 'dexie'
import type {
  AttachmentRole,
  CallbackDto,
  ChecklistTemplateDto,
  DefectCatalogItemDto,
  DefectDto,
  SyncBuildingDto,
  SyncContactDto,
  SyncElevatorDto,
  SyncJobDto,
  SyncPullDto,
  SyncPushKind,
  SyncUserDto,
  VisitDto,
} from '@avroleva/contracts'

/**
 * Local store of the technician app (ARCHITECTURE section 4): the whole tenant registry, the open
 * work, local copies of visits/callbacks/defects, photos as Blobs and the outbox. Dexie is the
 * cache; the service worker never caches API responses.
 */

export type BuildingRow = SyncBuildingDto
export type ElevatorRow = SyncElevatorDto
export type ContactRow = SyncContactDto
export type UserRow = SyncUserDto
export type JobRow = SyncJobDto
export type TemplateRow = ChecklistTemplateDto
export type CatalogRow = DefectCatalogItemDto
export type CallbackRow = CallbackDto

/** Server defect, or a local copy (`local: true`) until the server returns it. */
export type DefectRow = DefectDto & { local?: boolean }

/** Server visit, or the local pending copy (`local: true`) until the server copy arrives. */
export type VisitRow = VisitDto & { local?: boolean }

export interface BlobRow {
  id: string
  blob: Blob
  sha256: string
  takenAt: string
  visitId: string
  role: AttachmentRole
  bytes: number
}

export type OutboxKind = SyncPushKind | 'attachment.upload'
export type OutboxStatus = 'pending' | 'sending' | 'failed' | 'done'

export interface AttachmentUploadPayload {
  attachmentId: string
  visitId: string
  role: AttachmentRole
  takenAt: string
  sha256: string
}

export interface OutboxRow {
  /** UUID v7 (time-ordered); also the Idempotency-Key of the push request. */
  id: string
  kind: OutboxKind
  schemaVersion: 1
  /** Materialised once at creation and sent verbatim on every retry (idempotency hash). */
  payload: unknown
  createdAt: string
  attempts: number
  lastError: string | null
  status: OutboxStatus
  nextAttemptAt: string | null
  visitId?: string
  elevatorId?: string
  doneAt?: string
}

export interface MetaValues {
  session: { sessionId: string; expiresAt: string }
  user: { id: string; name: string; role: string }
  tenant: SyncPullDto['tenant']
  watermark: string
  clockOffsetMs: number
  clockMeasuredAt: string
  lastPullAt: string
  lastPushAt: string
  lastPullError: string | null
  deviceName: string
  locale: string
  apiBase: string
  needsReenroll: boolean
  storagePersisted: boolean
}
export type MetaKey = keyof MetaValues

export interface MetaRow {
  key: string
  value: unknown
}

export class TechDb extends Dexie {
  buildings!: EntityTable<BuildingRow, 'id'>
  elevators!: EntityTable<ElevatorRow, 'id'>
  contacts!: EntityTable<ContactRow, 'id'>
  users!: EntityTable<UserRow, 'id'>
  jobs!: EntityTable<JobRow, 'elevatorId'>
  checklistTemplates!: EntityTable<TemplateRow, 'id'>
  defectCatalog!: EntityTable<CatalogRow, 'code'>
  callbacks!: EntityTable<CallbackRow, 'id'>
  defects!: EntityTable<DefectRow, 'id'>
  visits!: EntityTable<VisitRow, 'id'>
  blobs!: EntityTable<BlobRow, 'id'>
  outbox!: EntityTable<OutboxRow, 'id'>
  meta!: EntityTable<MetaRow, 'key'>

  constructor() {
    super('avroleva-tech')
    this.version(1).stores({
      buildings: 'id',
      elevators: 'id, buildingId',
      contacts: 'id, buildingId',
      users: 'id',
      jobs: 'elevatorId, buildingId, state',
      checklistTemplates: 'id, key',
      defectCatalog: 'code',
      callbacks: 'id, elevatorId, status',
      defects: 'id, elevatorId, status',
      visits: 'id, elevatorId, startedAt',
      blobs: 'id, visitId',
      outbox: 'id, status, createdAt, visitId',
      meta: 'key',
    })
  }
}

export const db = new TechDb()

export const DATA_TABLES = [
  'buildings',
  'elevators',
  'contacts',
  'users',
  'jobs',
  'checklistTemplates',
  'defectCatalog',
  'callbacks',
  'defects',
  'visits',
] as const

export async function getMeta<K extends MetaKey>(key: K): Promise<MetaValues[K] | undefined> {
  const row = await db.meta.get(key)
  return row?.value as MetaValues[K] | undefined
}

export async function setMeta<K extends MetaKey>(key: K, value: MetaValues[K]): Promise<void> {
  await db.meta.put({ key, value })
}

export async function setMetaMany(values: Partial<MetaValues>): Promise<void> {
  const rows = Object.entries(values).map(([key, value]) => ({ key, value }))
  await db.meta.bulkPut(rows)
}

/** Typed view over the live `meta` rows (useLiveQuery(() => db.meta.toArray())). */
export function metaMap(rows: MetaRow[] | undefined): Partial<MetaValues> {
  const out: Record<string, unknown> = {}
  for (const r of rows ?? []) out[r.key] = r.value
  return out as Partial<MetaValues>
}

/** Wipes every table (logout). The database object stays usable afterwards. */
export async function clearAllData(): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((t) => t.clear()))
  })
}
