/**
 * Retention math (tenant.settings.retentionYears, weekly documents.retentionSweep). Pure.
 * `retentionYears = null` means keep everything (the default: firms keep a 10-year dossier).
 */
export const ORPHAN_GRACE_DAYS = 7

/** Visits started before this instant have their photos purged; null = nothing is purged. */
export function retentionCutoff(now: Date, retentionYears: number | null | undefined): Date | null {
  if (retentionYears == null || !Number.isFinite(retentionYears) || retentionYears < 1) return null
  const d = new Date(now.getTime())
  d.setUTCFullYear(d.getUTCFullYear() - Math.floor(retentionYears))
  return d
}

/** Uploads without a visit link older than this are abandoned. */
export function orphanCutoff(now: Date, graceDays = ORPHAN_GRACE_DAYS): Date {
  return new Date(now.getTime() - graceDays * 24 * 60 * 60 * 1000)
}
