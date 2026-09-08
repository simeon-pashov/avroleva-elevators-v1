import type {
  ChecklistGroupDef,
  ChecklistItemDef,
  ChecklistSnapshotDto,
  ChecklistSnapshotInput,
  ChecklistTemplateDto,
  ElevatorTypeFacts,
} from '@avroleva/contracts'
import { applicableItems, summarizeChecklist } from '@avroleva/contracts'
import { checklistTemplates } from '@avroleva/domain-data'
import type { Ctx } from '../../../platform/http/ctx.js'
import { AppError, notFound } from '../../../platform/http/errors.js'
import type { Tx } from '../../../platform/db/prisma.js'
import { elevators } from '../../registry/index.js'
import * as repo from '../repo/checklists.js'
import type { ChecklistTemplateRow } from '../repo/checklists.js'

export function toTemplateDto(t: ChecklistTemplateRow): ChecklistTemplateDto {
  return {
    id: t.id,
    tenantId: t.tenantId,
    key: t.key,
    version: t.version,
    name: t.name as { bg: string; en: string },
    groups: (t.groups as unknown as ChecklistGroupDef[]) ?? [],
    items: (t.items as unknown as ChecklistItemDef[]) ?? [],
    active: t.active,
    updatedAt: t.updatedAt.toISOString(),
  }
}

/** Every active template visible to the tenant (tenant clones shadow system rows per key). */
export async function listActive(tenantId: string): Promise<ChecklistTemplateDto[]> {
  const rows = await repo.listActiveForTenant(tenantId)
  const byKey = new Map<string, ChecklistTemplateRow>()
  for (const r of rows) {
    const cur = byKey.get(r.key)
    // Prefer the tenant's own row; among equals the highest version (rows arrive version desc).
    if (!cur || (cur.tenantId === null && r.tenantId !== null)) byKey.set(r.key, r)
  }
  return [...byKey.values()].map(toTemplateDto)
}

/** GET /checklists/active?elevatorId - the tenant's template with only the items that apply. */
export async function activeForElevator(
  ctx: Ctx,
  elevatorId: string,
  key = 'functional_check',
): Promise<ChecklistTemplateDto> {
  const e = await elevators.find(ctx.tenantId, elevatorId)
  if (!e) throw notFound()
  const all = await listActive(ctx.tenantId)
  const t = all.find((x) => x.key === key)
  if (!t) throw new AppError(404, 'checklists.templateNotFound')
  return { ...t, items: applicableItems(t.items, e) }
}

/**
 * Turns a client's answers into the stored snapshot: labels and groups come from the template
 * (tenant clone or system row) at that key/version, so the history is self-contained. Unknown
 * item codes are a 400; items that do not apply to the lift are kept as sent (the phone filtered).
 */
export async function snapshotFor(
  tenantId: string,
  input: ChecklistSnapshotInput,
  _facts: ElevatorTypeFacts,
  tx?: Tx,
): Promise<ChecklistSnapshotDto> {
  const row = await repo.findByKeyVersion(tenantId, input.templateKey, input.templateVersion, tx)
  if (!row) throw new AppError(400, 'checklists.templateNotFound')
  const defs = new Map((row.items as unknown as ChecklistItemDef[]).map((i) => [i.code, i]))
  const items = input.items.map((i) => {
    const d = defs.get(i.code)
    if (!d)
      throw new AppError(400, 'error.validation', {
        fields: [{ path: `checklist.items.${i.code}`, code: 'checklists.unknownItem' }],
      })
    return {
      code: d.code,
      group: d.group,
      label: { bg: d.bg, en: d.en },
      result: i.result,
      note: i.note ?? null,
    }
  })
  return {
    templateKey: row.key,
    templateVersion: row.version,
    items,
    summary: summarizeChecklist(items),
  }
}

/** Seeds every system template of packages/domain-data (idempotent). */
export async function ensureSystemTemplates(): Promise<number> {
  let n = 0
  for (const t of checklistTemplates) {
    await repo.upsertSystemTemplate({
      key: t.key,
      version: t.version,
      name: t.name,
      groups: t.groups,
      items: t.items,
    })
    n++
  }
  return n
}
