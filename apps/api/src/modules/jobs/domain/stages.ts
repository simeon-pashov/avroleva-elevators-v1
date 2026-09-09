import { jobStageDefaults } from '@avroleva/domain-data'
import type { JobStageDto } from '@avroleva/contracts'

/**
 * The job stage machine as data (step 8): a list of stages with `allowedNext`, terminal flags and
 * "this transition needs approval evidence". System defaults come from
 * packages/domain-data/jobs/stages.v1.json; a tenant with its own rows replaces the whole list.
 * Everything here is pure - the service only asks these questions.
 */
export interface StageDef {
  code: string
  labelBg: string
  labelEn: string
  position: number
  isTerminal: boolean
  allowedNext: string[]
  requiresEvidence: boolean
}

export function defaultStages(): StageDef[] {
  return jobStageDefaults.stages.map((s, i) => ({
    code: s.code,
    labelBg: s.bg,
    labelEn: s.en,
    position: i + 1,
    isTerminal: s.isTerminal,
    allowedNext: [...s.allowedNext],
    requiresEvidence: s.requiresEvidence,
  }))
}

/** Positions recomputed from the list order (1-based). */
export function orderStages<T extends Omit<StageDef, 'position'>>(
  stages: T[],
): Array<T & { position: number }> {
  return stages.map((s, i) => ({ ...s, position: i + 1 }))
}

export function stageOf(stages: StageDef[], code: string): StageDef | undefined {
  return stages.find((s) => s.code === code)
}

/** A transition is allowed when the source stage lists the target in `allowedNext`. */
export function canTransition(stages: StageDef[], from: string, to: string): boolean {
  if (from === to) return false
  const src = stageOf(stages, from)
  const dst = stageOf(stages, to)
  if (!src || !dst) return false
  return src.allowedNext.includes(to)
}

export function requiresEvidence(stages: StageDef[], to: string): boolean {
  return stageOf(stages, to)?.requiresEvidence ?? false
}

export function isTerminal(stages: StageDef[], code: string): boolean {
  return stageOf(stages, code)?.isTerminal ?? false
}

/** Codes of every non-terminal stage ("open" jobs). */
export function openStageCodes(stages: StageDef[]): string[] {
  return stages.filter((s) => !s.isTerminal).map((s) => s.code)
}

/**
 * Validation of a tenant's list: unique codes, every `allowedNext` target exists, the list keeps
 * the stages the code relies on (draft, approved, scheduled, in_progress, done, invoiced,
 * rejected, cancelled - the commands move jobs into them) and at least one terminal stage.
 */
export const REQUIRED_STAGE_CODES = [
  'draft',
  'quoted',
  'awaiting_approval',
  'approved',
  'scheduled',
  'in_progress',
  'done',
  'invoiced',
  'rejected',
  'cancelled',
] as const

export function validateStages(
  stages: Array<Omit<StageDef, 'position'>>,
): { ok: true } | { ok: false; code: string; detail?: string } {
  const codes = new Set<string>()
  for (const s of stages) {
    if (codes.has(s.code)) return { ok: false, code: 'jobs.stages.duplicateCode', detail: s.code }
    codes.add(s.code)
  }
  for (const req of REQUIRED_STAGE_CODES) {
    if (!codes.has(req)) return { ok: false, code: 'jobs.stages.missingRequired', detail: req }
  }
  for (const s of stages) {
    for (const n of s.allowedNext) {
      if (!codes.has(n)) return { ok: false, code: 'jobs.stages.unknownNext', detail: n }
    }
  }
  if (!stages.some((s) => s.isTerminal)) return { ok: false, code: 'jobs.stages.noTerminal' }
  return { ok: true }
}

export function toStageDto(s: StageDef): JobStageDto {
  return {
    code: s.code,
    label: { bg: s.labelBg, en: s.labelEn },
    position: s.position,
    isTerminal: s.isTerminal,
    allowedNext: [...s.allowedNext],
    requiresEvidence: s.requiresEvidence,
  }
}
