import { prisma, prismaBase } from '../../../platform/db/prisma.js'
import type { Tx } from '../../../platform/db/prisma.js'
import { newId } from '../../../platform/ids.js'
import type { ChecklistTemplate } from '../../../generated/prisma/index.js'

export type ChecklistTemplateRow = ChecklistTemplate

/**
 * checklist_template is a reference table with tenant overrides (ARCHITECTURE section 3): system
 * rows have tenantId NULL, so it is NOT in `tenantOwnedModels`; every read below is explicit about
 * which tenant (or NULL) it wants.
 */
export function listActiveForTenant(
  tenantId: string,
  key?: string,
): Promise<ChecklistTemplateRow[]> {
  return prisma.checklistTemplate.findMany({
    where: {
      OR: [{ tenantId }, { tenantId: null }],
      active: true,
      deletedAt: null,
      ...(key ? { key } : {}),
    },
    orderBy: [{ key: 'asc' }, { version: 'desc' }],
  })
}

export function findByKeyVersion(
  tenantId: string,
  key: string,
  version: number,
  tx?: Tx,
): Promise<ChecklistTemplateRow | null> {
  const db = tx ?? prisma
  return db.checklistTemplate.findFirst({
    where: { OR: [{ tenantId }, { tenantId: null }], key, version, deletedAt: null },
    // A tenant clone shadows the system row of the same key/version.
    orderBy: { tenantId: 'desc' },
  })
}

export interface TemplateInput {
  key: string
  version: number
  name: { bg: string; en: string }
  groups: unknown[]
  items: unknown[]
}

/** Seed helper: upsert the system row (tenantId NULL) of a key/version. */
export async function upsertSystemTemplate(t: TemplateInput): Promise<ChecklistTemplateRow> {
  const existing = await prismaBase.checklistTemplate.findFirst({
    where: { tenantId: null, key: t.key, version: t.version },
  })
  if (existing) {
    return prismaBase.checklistTemplate.update({
      where: { id: existing.id },
      data: {
        name: t.name,
        groups: t.groups as object[],
        items: t.items as object[],
        active: true,
      },
    })
  }
  return prismaBase.checklistTemplate.create({
    data: {
      id: newId(),
      tenantId: null,
      key: t.key,
      version: t.version,
      name: t.name,
      groups: t.groups as object[],
      items: t.items as object[],
      active: true,
    },
  })
}
