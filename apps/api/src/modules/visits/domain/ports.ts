import type {
  ChecklistSnapshotDto,
  ChecklistSnapshotInput,
  ElevatorTypeFacts,
} from '@avroleva/contracts'
import type { Tx } from '../../../platform/db/prisma.js'

/**
 * Checklist port (ARCHITECTURE section 1.1 rule 2): visits (L3) snapshots the answered items
 * against the template, but the templates belong to maintenance (L3, same layer). The
 * composition root wires `maintenance.checklists.snapshotFor` here.
 */
export interface ChecklistResolver {
  snapshotFor(
    tenantId: string,
    input: ChecklistSnapshotInput,
    facts: ElevatorTypeFacts,
    tx?: Tx,
  ): Promise<ChecklistSnapshotDto>
}

let resolver: ChecklistResolver | null = null

export function useChecklistResolver(r: ChecklistResolver): void {
  resolver = r
}

export function checklistResolver(): ChecklistResolver {
  if (!resolver) throw new Error('ChecklistResolver not wired (app.ts)')
  return resolver
}
