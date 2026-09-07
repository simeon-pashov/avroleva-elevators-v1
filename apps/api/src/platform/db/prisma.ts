import { PrismaClient } from '../../generated/prisma/index.js'
import { config } from '../config.js'
import { tenantOwnedModels } from './ownership.js'

export class TenantScopeError extends Error {
  constructor(model: string, operation: string) {
    super(`Query on tenant-owned model ${model}.${operation} lacks tenantId`)
    this.name = 'TenantScopeError'
  }
}

const READ_OR_WRITE_BY_WHERE = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'findUnique',
  'findUniqueOrThrow',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
])

function hasTenantId(where: unknown): boolean {
  if (!where || typeof where !== 'object') return false
  const w = where as Record<string, unknown>
  if (typeof w.tenantId === 'string') return true
  if (Array.isArray(w.AND)) return w.AND.some(hasTenantId)
  return false
}

/** Throws when a query on a tenant-owned model is not scoped by tenantId (ARCHITECTURE section 5). */
export function assertTenantScoped(model: string, operation: string, args: unknown): void {
  if (!tenantOwnedModels.has(model)) return
  const a = (args ?? {}) as Record<string, unknown>
  if (READ_OR_WRITE_BY_WHERE.has(operation)) {
    if (!hasTenantId(a.where)) throw new TenantScopeError(model, operation)
    return
  }
  if (operation === 'create') {
    if (!hasTenantId(a.data)) throw new TenantScopeError(model, operation)
    return
  }
  if (operation === 'createMany' || operation === 'createManyAndReturn') {
    const data = a.data
    const rows = Array.isArray(data) ? data : [data]
    if (!rows.every(hasTenantId)) throw new TenantScopeError(model, operation)
    return
  }
  if (operation === 'upsert') {
    if (!hasTenantId(a.where) || !hasTenantId(a.create))
      throw new TenantScopeError(model, operation)
  }
}

function createClient(url: string) {
  return new PrismaClient({
    datasourceUrl: url,
    log: config.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  })
}

const databaseUrl =
  config.NODE_ENV === 'test' && config.TEST_DATABASE_URL
    ? config.TEST_DATABASE_URL
    : config.DATABASE_URL

/** Unscoped client - only for tenancy's login/session resolution, admin operations, seeds and tests. */
export const prismaBase = createClient(databaseUrl)

/** Tenant-guarded client: every query on a tenant-owned model must carry tenantId. */
export const prisma = prismaBase.$extends({
  name: 'tenantGuard',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        assertTenantScoped(model, operation, args)
        return query(args)
      },
    },
  },
})

export type Db = typeof prisma
/** Transaction client with the same (guarded) shape as `prisma`; obtain one via `transaction()`. */
export type Tx = Omit<Db, '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends' | '$use'>

export function transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction((tx) => fn(tx as unknown as Tx))
}

export async function disconnectDb(): Promise<void> {
  await prismaBase.$disconnect()
}
