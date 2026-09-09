import { prismaBase } from '../../../platform/db/prisma.js'
import { newId } from '../../../platform/ids.js'
import type {
  DunningStage,
  LateFeeRule,
  NotificationChannel,
  Prisma,
} from '../../../generated/prisma/index.js'

/**
 * Dunning stages and late-fee rules: system rows (tenantId NULL) plus tenant rows. These two
 * models carry a nullable tenantId (like notification_template), so the unscoped client is used
 * with an explicit tenant filter in every query.
 */
export type StageRow = DunningStage
export type RuleRow = LateFeeRule

export function stagesOf(tenantId: string | null): Promise<StageRow[]> {
  return prismaBase.dunningStage.findMany({
    where: { tenantId },
    orderBy: [{ position: 'asc' }, { key: 'asc' }],
  })
}

export function rulesOf(tenantId: string | null): Promise<RuleRow[]> {
  return prismaBase.lateFeeRule.findMany({ where: { tenantId }, orderBy: { key: 'asc' } })
}

export interface StageInput {
  key: string
  position: number
  offsetDays: number
  channel: NotificationChannel
  templateKey: string
  lateFeeRuleKey: string | null
  active: boolean
}

/** Replaces a tenant's list (or the system list when tenantId is null) inside one transaction. */
export async function replaceStages(
  tenantId: string | null,
  stages: StageInput[],
): Promise<StageRow[]> {
  return prismaBase.$transaction(async (tx) => {
    await tx.dunningStage.deleteMany({ where: { tenantId } })
    for (const s of stages) {
      await tx.dunningStage.create({ data: { id: newId(), tenantId, ...s } })
    }
    return tx.dunningStage.findMany({ where: { tenantId }, orderBy: { position: 'asc' } })
  })
}

export async function ensureStage(tenantId: string | null, s: StageInput): Promise<boolean> {
  const existing = await prismaBase.dunningStage.findFirst({ where: { tenantId, key: s.key } })
  if (existing) return false
  await prismaBase.dunningStage.create({ data: { id: newId(), tenantId, ...s } })
  return true
}

export interface RuleInput {
  key: string
  kind: 'flat' | 'percent'
  amountCents: number
  percentBp: number
  graceDays: number
  capCents: number | null
  enabled: boolean
}

export async function upsertRule(tenantId: string | null, r: RuleInput): Promise<RuleRow> {
  const existing = await prismaBase.lateFeeRule.findFirst({ where: { tenantId, key: r.key } })
  const data: Prisma.LateFeeRuleUncheckedUpdateInput = { ...r }
  if (existing) return prismaBase.lateFeeRule.update({ where: { id: existing.id }, data })
  return prismaBase.lateFeeRule.create({ data: { id: newId(), tenantId, ...r } })
}

export async function ensureRule(tenantId: string | null, r: RuleInput): Promise<boolean> {
  const existing = await prismaBase.lateFeeRule.findFirst({ where: { tenantId, key: r.key } })
  if (existing) return false
  await prismaBase.lateFeeRule.create({ data: { id: newId(), tenantId, ...r } })
  return true
}
