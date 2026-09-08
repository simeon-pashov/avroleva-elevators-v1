/**
 * FileStorage port (ARCHITECTURE section 6). Adapters: platform/adapters/storage/local.ts today,
 * an S3-compatible one later (a config change plus a copy script). Keys are relative paths
 * `attachments/<tenantId>/<yy>/<mm>/<id>[.thumb].jpg`; the adapter decides where they live.
 */
export interface StoredFile {
  bytes: Buffer
  mime: string
}

export interface FileStorage {
  readonly name: string
  put(key: string, bytes: Buffer, mime: string): Promise<void>
  get(key: string): Promise<StoredFile | null>
  exists(key: string): Promise<boolean>
  /** Used only by the tenant purge (deleteTenantData) and by tests. */
  remove(key: string): Promise<void>
}
