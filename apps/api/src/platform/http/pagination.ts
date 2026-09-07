import type { Page } from '@avroleva/contracts'

/**
 * Cursor pagination over `id` (UUIDv7 = creation order), newest first (ARCHITECTURE section 5).
 * Usage: `findMany({ ...pageArgs(q), where })` then `toPage(rows, q.limit)`.
 */
export function pageArgs(q: { cursor?: string; limit: number }) {
  return {
    take: q.limit + 1,
    orderBy: { id: 'desc' as const },
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
  }
}

export function toPage<T extends { id: string }, R = T>(
  rows: T[],
  limit: number,
  map: (row: T) => R = (r) => r as unknown as R,
): Page<R> {
  const hasMore = rows.length > limit
  const items = (hasMore ? rows.slice(0, limit) : rows).map(map)
  return { items, nextCursor: hasMore ? rows[limit - 1]!.id : null }
}
