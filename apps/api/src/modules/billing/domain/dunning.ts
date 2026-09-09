import type { NotificationChannel } from '@avroleva/contracts'
import { addDays } from '../../../platform/clock.js'

/**
 * Dunning schedule math (pure, ADR 0001 section 2). Stages are rows (system defaults or the
 * tenant's own); the invoice remembers the position of the last stage it reached, so a run is
 * idempotent and a missed day jumps to the latest stage that is due instead of replaying every
 * step. Late fees come from a rule the stage names; one fee per (invoice, stage), capped.
 */
export interface StageLike {
  key: string
  position: number
  offsetDays: number
  channel: NotificationChannel
  templateKey: string
  lateFeeRuleKey: string | null
  active: boolean
}

export interface LateFeeRuleLike {
  key: string
  kind: 'flat' | 'percent'
  amountCents: number
  percentBp: number
  graceDays: number
  capCents: number | null
  enabled: boolean
}

export interface DunnableInvoice {
  id: string
  /** YYYY-MM-DD */
  dueAt: string
  openCents: number
  totalCents: number
  dunningStage: number
  lateFeeCents: number
}

/** Stages sorted by offset with positions 1..n (the position is what the invoice stores). */
export function orderStages<S extends Omit<StageLike, 'position'>>(
  stages: S[],
): Array<S & { position: number }> {
  return [...stages]
    .sort((a, b) => a.offsetDays - b.offsetDays || a.key.localeCompare(b.key))
    .map((s, i) => ({ ...s, position: i + 1 }))
}

/** The latest active stage whose offset is reached and that the invoice has not reached yet. */
export function nextStage(
  stages: StageLike[],
  invoice: DunnableInvoice,
  today: string,
): StageLike | null {
  if (invoice.openCents <= 0) return null
  let best: StageLike | null = null
  for (const s of stages) {
    if (!s.active || s.position <= invoice.dunningStage) continue
    if (addDays(invoice.dueAt, s.offsetDays) > today) continue
    if (!best || s.position > best.position) best = s
  }
  return best
}

/** Days after the due date at which a stage fires (for previews and tests). */
export function stageDate(invoiceDueAt: string, stage: Pick<StageLike, 'offsetDays'>): string {
  return addDays(invoiceDueAt, stage.offsetDays)
}

/**
 * Late fee for an invoice under a rule, or 0: disabled rule, grace period not over, or the cap
 * already reached. Percent rules apply to the invoice total (not the open balance) so a partial
 * payment does not change the fee.
 */
export function lateFeeFor(
  rule: LateFeeRuleLike | null | undefined,
  invoice: DunnableInvoice,
  today: string,
): number {
  if (!rule || !rule.enabled) return 0
  if (addDays(invoice.dueAt, rule.graceDays) > today) return 0
  let fee =
    rule.kind === 'percent'
      ? Math.round((invoice.totalCents * rule.percentBp) / 10_000)
      : rule.amountCents
  if (rule.capCents != null) fee = Math.min(fee, Math.max(0, rule.capCents - invoice.lateFeeCents))
  return Math.max(0, fee)
}
