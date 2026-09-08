import { TENANT_DELETION_GRACE_DAYS } from '@avroleva/contracts'
import type { TenantStatus } from '../../../generated/prisma/index.js'

/**
 * Delete-my-data state machine (ARCHITECTURE section 6, "data custody stance"):
 *   active --requestDeletion--> deletion_scheduled --(30 days)--> purged (row gone)
 *                                       \\--cancelDeletion (until the date)--> active
 * Pure functions; the service applies them.
 */
export function deletionDate(now: Date, graceDays = TENANT_DELETION_GRACE_DAYS): Date {
  return new Date(now.getTime() + graceDays * 24 * 60 * 60 * 1000)
}

export function canRequestDeletion(status: TenantStatus): boolean {
  return status === 'active' || status === 'read_only'
}

/** Cancellable while scheduled and the date has not passed (the sweep may already be running). */
export function canCancelDeletion(
  status: TenantStatus,
  deletionAt: Date | null,
  now: Date,
): boolean {
  return (
    status === 'deletion_scheduled' && deletionAt !== null && deletionAt.getTime() > now.getTime()
  )
}

export function isDueForPurge(status: TenantStatus, deletionAt: Date | null, now: Date): boolean {
  return (
    status === 'deletion_scheduled' && deletionAt !== null && deletionAt.getTime() <= now.getTime()
  )
}

/** Whole days left before the purge (0 when due today or past). */
export function daysUntilDeletion(deletionAt: Date, now: Date): number {
  return Math.max(0, Math.ceil((deletionAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)))
}
