import { prismaBase } from '../../../platform/db/prisma.js'
import { newId } from '../../../platform/ids.js'
import type { JobStage } from '../../../generated/prisma/index.js'
import type { StageDef } from '../domain/stages.js'

/**
 * Job stages: system rows (tenantId NULL) plus tenant rows. The model carries a nullable
 * tenantId (like dunning_stage), so the unscoped client is used with an explicit tenant filter.
 */
export type StageRow = JobStage

export function stagesOf(tenantId: string | null): Promise<StageRow[]> {
  return prismaBase.jobStage.findMany({
    where: { tenantId, active: true },
    orderBy: [{ position: 'asc' }, { code: 'asc' }],
  })
}

export function toDef(r: StageRow): StageDef {
  return {
    code: r.code,
    labelBg: r.labelBg,
    labelEn: r.labelEn,
    position: r.position,
    isTerminal: r.isTerminal,
    allowedNext: r.allowedNext,
    requiresEvidence: r.requiresEvidence,
  }
}

/** Replaces a tenant's list (empty = back to the system default) in one transaction. */
export async function replaceStages(tenantId: string, stages: StageDef[]): Promise<StageRow[]> {
  return prismaBase.$transaction(async (tx) => {
    await tx.jobStage.deleteMany({ where: { tenantId } })
    for (const s of stages) {
      await tx.jobStage.create({ data: { id: newId(), tenantId, ...s } })
    }
    return tx.jobStage.findMany({ where: { tenantId }, orderBy: { position: 'asc' } })
  })
}

export async function ensureSystemStage(s: StageDef): Promise<boolean> {
  const existing = await prismaBase.jobStage.findFirst({ where: { tenantId: null, code: s.code } })
  if (existing) return false
  await prismaBase.jobStage.create({ data: { id: newId(), tenantId: null, ...s } })
  return true
}
