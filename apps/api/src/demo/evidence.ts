import sharp from 'sharp'
import { applicableItems } from '@avroleva/contracts'
import type { ChecklistItemDef, ChecklistResult } from '@avroleva/contracts'
import { prismaBase as db } from '../platform/db/prisma.js'
import { Prisma } from '../generated/prisma/index.js'
import { newId } from '../platform/ids.js'
import { adapters } from '../platform/adapters/index.js'
import { checklists } from '../modules/maintenance/index.js'
import { sha256Of, storageKeyFor } from '../modules/documents/index.js'

/**
 * Demo evidence (moved from the step 4 seed): the newest functional checks of the demo tenant get a checklist snapshot
 * (recorded "from the app"), one or two generated placeholder photos and, on a few, a photo of
 * the logbook page - so the office shows thumbnails and the print page has content. Idempotent:
 * runs only while the tenant has no attachments.
 */
export async function seedEvidence(tenantId: string): Promise<Record<string, number>> {
  const counts = { checklistVisits: 0, attachments: 0 }
  if ((await db.attachment.count({ where: { tenantId } })) > 0) return counts

  const templates = await checklists.listActive(tenantId)
  const template = templates.find((t) => t.key === 'functional_check')
  if (!template) return counts

  const visits = await db.visit.findMany({
    where: {
      tenantId,
      kind: 'functional_check',
      supersededAt: null,
      checklist: { equals: Prisma.AnyNull },
    },
    orderBy: { startedAt: 'desc' },
    take: 10,
    include: { elevator: true },
  })
  const now = new Date()
  for (const [i, v] of visits.entries()) {
    const facts = {
      driveType: v.elevator.driveType,
      doorType: v.elevator.doorType,
      goodsOnly: v.elevator.goodsOnly,
    }
    const items = applicableItems(template.items as ChecklistItemDef[], facts)
    const answers = items.map((it, j) => ({
      code: it.code,
      result: (i % 3 === 1 && j === 4 ? 'defect' : 'ok') as ChecklistResult,
      note: i % 3 === 1 && j === 4 ? 'Износени ролки – планирана смяна.' : null,
    }))
    const snapshot = await checklists.snapshotFor(
      tenantId,
      { templateKey: template.key, templateVersion: template.version, items: answers },
      facts,
    )
    await db.visit.update({
      where: { id: v.id },
      data: {
        source: 'app',
        timestampSource: 'device',
        clientOffsetMs: (i % 4) * 700,
        templateKey: snapshot.templateKey,
        templateVersion: snapshot.templateVersion,
        checklist: snapshot as object,
      },
    })
    counts.checklistVisits++

    const photoCount = 1 + (i % 2)
    for (let p = 0; p < photoCount; p++) {
      const role = p === 1 && i % 2 === 1 ? 'logbook_page' : 'photo'
      const id = newId()
      const label =
        role === 'logbook_page'
          ? `Дневник · ${v.elevator.internalNo}`
          : `Машинно помещение · ${v.elevator.internalNo}`
      const { full, thumb } = await placeholderPhoto(label, (i * 37 + p * 91) % 360)
      const storageKey = storageKeyFor(tenantId, id, now)
      const thumbKey = storageKeyFor(tenantId, id, now, '.thumb')
      await adapters.storage.put(storageKey, full, 'image/jpeg')
      await adapters.storage.put(thumbKey, thumb, 'image/jpeg')
      await db.attachment.create({
        data: {
          id,
          tenantId,
          kind: 'photo',
          sha256: sha256Of(full),
          mime: 'image/jpeg',
          bytes: full.length,
          width: 1280,
          height: 960,
          takenAt: v.startedAt,
          storageKey,
          thumbKey,
          createdByUserId: v.createdByUserId,
        },
      })
      await db.visitAttachment.create({
        data: { id: newId(), tenantId, visitId: v.id, attachmentId: id, role, position: p },
      })
      counts.attachments++
    }
  }
  return counts
}

/** A 1280x960 JPEG with a coloured background and a Cyrillic caption, plus its 320 px thumbnail. */
async function placeholderPhoto(label: string, hue: number) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="960">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${hue},35%,45%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360},30%,25%)"/>
    </linearGradient></defs>
    <rect width="1280" height="960" fill="url(#g)"/>
    <rect x="80" y="120" width="1120" height="620" rx="24" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.35)" stroke-width="6"/>
    <text x="640" y="470" font-family="DejaVu Sans, Arial, sans-serif" font-size="54" fill="#fff" text-anchor="middle">${escapeXml(label)}</text>
    <text x="640" y="850" font-family="DejaVu Sans, Arial, sans-serif" font-size="34" fill="rgba(255,255,255,0.8)" text-anchor="middle">демо снимка</text>
  </svg>`
  const base = sharp(Buffer.from(svg))
  const full = await base.clone().jpeg({ quality: 80 }).toBuffer()
  const thumb = await base
    .clone()
    .resize({ width: 320, height: 320, fit: 'inside' })
    .jpeg({ quality: 70 })
    .toBuffer()
  return { full, thumb }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
