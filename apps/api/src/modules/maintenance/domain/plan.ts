import type { PlanStop } from '@avroleva/contracts'

/**
 * Day-plan merge rules (step 9), pure. A plan is one ordered list of stops; regeneration must
 * never throw away what a person did (a done stop, a stop the office added or moved by hand)
 * and must never touch a locked plan.
 */
export const stopKey = (s: { kind: string; refId: string }): string => `${s.kind}:${s.refId}`

/** A stop regeneration keeps: not planned any more (done / skipped) or placed by hand. */
export function isKept(s: PlanStop): boolean {
  return s.status !== 'planned' || s.manual === true
}

export function renumber(stops: PlanStop[]): PlanStop[] {
  return stops.map((s, i) => ({ ...s, order: i }))
}

/** First occurrence per kind+refId wins. */
export function dedupeStops<T extends { kind: string; refId: string }>(stops: T[]): T[] {
  const seen = new Set<string>()
  return stops.filter((s) => {
    const k = stopKey(s)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/**
 * - locked: the existing list comes back unchanged (nothing added, nothing removed).
 * - unlocked: kept stops (done / skipped / manual) stay at their place; the planned ones are
 *   replaced by the candidates in the candidates' order (deduped by kind+refId, a candidate
 *   that matches an existing planned stop reuses that stop's id so the phone's references
 *   stay valid), then the order is renumbered.
 */
export function mergeRegeneration(
  existing: PlanStop[] | null,
  locked: boolean,
  candidates: PlanStop[],
): PlanStop[] {
  if (existing && locked) return existing.map((s) => ({ ...s }))
  const current = existing ?? []
  if (current.length === 0) return renumber(dedupeStops(candidates).map((c) => ({ ...c })))
  const keptKeys = new Set(current.filter(isKept).map(stopKey))
  const byKey = new Map(current.map((s) => [stopKey(s), s]))
  const queue = dedupeStops(candidates).filter((c) => !keptKeys.has(stopKey(c)))
  const out: PlanStop[] = []
  let ci = 0
  for (let i = 0; i < current.length || ci < queue.length; i++) {
    const ex = current[i]
    if (ex && isKept(ex)) {
      out.push({ ...ex })
      continue
    }
    if (ci < queue.length) {
      const c = queue[ci++]!
      const prior = byKey.get(stopKey(c))
      out.push(
        prior
          ? {
              ...prior,
              elevatorId: c.elevatorId,
              buildingId: c.buildingId,
              plannedAt: c.plannedAt ?? prior.plannedAt ?? null,
            }
          : { ...c },
      )
    }
  }
  return renumber(out)
}

/** Contiguous chunks of ceil(n / parts) items; trailing chunks may be empty. */
export function chunkEvenly<T>(items: T[], parts: number): T[][] {
  const n = Math.max(1, parts)
  const size = Math.ceil(items.length / n)
  return Array.from({ length: n }, (_, i) => items.slice(i * size, (i + 1) * size))
}

/** Index of the first pair (by list order) that contains one of the users, or -1. */
export function pairIndexForUsers(
  pairs: ReadonlyArray<{ userIds: ReadonlyArray<string> }>,
  userIds: ReadonlyArray<string>,
): number {
  if (userIds.length === 0) return -1
  return pairs.findIndex((p) => p.userIds.some((u) => userIds.includes(u)))
}
