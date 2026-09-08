import { z } from 'zod'
import type { DoorType, DriveType } from './enums.js'
import { nullableText } from './common.js'

/**
 * Checklist templates are data (packages/domain-data/checklists/*.json), not code: the office may
 * clone the system template per tenant and edit it later. A visit stores a full snapshot of the
 * items it was recorded against, so the history never depends on the template that exists today.
 */
export const ChecklistResult = z.enum(['ok', 'defect', 'na'])
export type ChecklistResult = z.infer<typeof ChecklistResult>

export interface ChecklistAppliesTo {
  driveType?: DriveType[]
  doorType?: DoorType[]
  /** true = goods-only lifts, false = passenger lifts only, absent = both. */
  goodsOnly?: boolean
}

export interface ChecklistGroupDef {
  code: string
  bg: string
  en: string
}

export interface ChecklistItemDef {
  code: string
  group: string
  bg: string
  en: string
  appliesTo: ChecklistAppliesTo
  resultType: 'ok_defect_na'
}

export interface ChecklistTemplateDto {
  id: string
  /** null = the system template shared by every tenant. */
  tenantId: string | null
  key: string
  version: number
  name: { bg: string; en: string }
  groups: ChecklistGroupDef[]
  items: ChecklistItemDef[]
  active: boolean
  updatedAt: string
}

export const checklistActiveQuery = z.object({
  elevatorId: z.uuid(),
  key: z.string().trim().min(1).max(60).default('functional_check'),
})
export type ChecklistActiveQuery = z.infer<typeof checklistActiveQuery>

export interface ElevatorTypeFacts {
  driveType: DriveType
  doorType: DoorType
  goodsOnly: boolean
}

/** Pure filter shared by the API (GET /checklists/active) and the technician app (offline). */
export function applicableItems<T extends { appliesTo: ChecklistAppliesTo }>(
  items: T[],
  e: ElevatorTypeFacts,
): T[] {
  return items.filter((i) => {
    const a = i.appliesTo ?? {}
    if (a.driveType && a.driveType.length > 0 && !a.driveType.includes(e.driveType)) return false
    if (a.doorType && a.doorType.length > 0 && !a.doorType.includes(e.doorType)) return false
    if (a.goodsOnly !== undefined && a.goodsOnly !== e.goodsOnly) return false
    return true
  })
}

/** One answered item as sent by a client. Labels are attached server-side from the template. */
export const checklistResultItem = z.object({
  code: z.string().trim().min(1).max(40),
  result: ChecklistResult,
  note: nullableText(500),
})
export type ChecklistResultItem = z.infer<typeof checklistResultItem>

export const checklistSnapshotInput = z.object({
  templateKey: z.string().trim().min(1).max(60),
  templateVersion: z.number().int().min(1),
  items: z.array(checklistResultItem).max(200),
})
export type ChecklistSnapshotInput = z.infer<typeof checklistSnapshotInput>

/** What the visit stores: every answered item with its label at recording time. */
export interface ChecklistSnapshotItem {
  code: string
  group: string
  label: { bg: string; en: string }
  result: ChecklistResult
  note: string | null
}

export interface ChecklistSnapshotDto {
  templateKey: string
  templateVersion: number
  items: ChecklistSnapshotItem[]
  summary: { ok: number; defect: number; na: number }
}

export function summarizeChecklist(items: Array<{ result: ChecklistResult }>) {
  const summary = { ok: 0, defect: 0, na: 0 }
  for (const i of items) summary[i.result]++
  return summary
}
