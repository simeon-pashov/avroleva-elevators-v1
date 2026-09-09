import { prismaBase as db } from '../platform/db/prisma.js'
import { newId } from '../platform/ids.js'
import { addDays } from '../platform/clock.js'

const TECHNICIANS = ['Иван Петров', 'Петър Иванов', 'Георги Димитров', 'Стоян Колев']
const REPAIR_NOTES = [
  'Смяна на ролки на кабинните врати.',
  'Регулиране на спирачката; проверка на въжетата.',
  'Подмяна на бутон на етажен пост, 3 ет.',
  'Почистване на шахтата и смазване на водачите.',
  'Смяна на осветление в кабината.',
]

/**
 * 6-18 months of visits per elevator, walking backwards from lastCheckAt at the elevator's
 * interval (with a little jitter), mostly functional checks, every 4th a technical maintenance
 * and the odd repair. Idempotent: an elevator that already has visits only gets a check visit on
 * its (re-seeded, today-relative) lastCheckAt when the newest visit is older than that.
 */
export async function seedVisits(
  tenantId: string,
  rows: Array<{
    row: { id: string; buildingId: string }
    interval: number
    lastCheckAt: string | null
  }>,
  today: string,
): Promise<number> {
  let created = 0
  // The tenant's own technicians sign the visits; the sample names fill in when it has fewer than four.
  const techUsers = await db.user.findMany({
    where: { tenantId, role: 'technician', isActive: true, deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true },
  })
  const names = [...techUsers.map((u) => u.name), ...TECHNICIANS].slice(0, 4)
  const userIdByName = new Map<string, string>(techUsers.map((u) => [u.name, u.id]))

  for (const [i, r] of rows.entries()) {
    if (!r.lastCheckAt) continue
    const existing = await db.visit.count({ where: { tenantId, elevatorId: r.row.id } })
    const latest = existing
      ? await db.visit.findFirst({
          where: { tenantId, elevatorId: r.row.id },
          orderBy: { startedAt: 'desc' },
          select: { startedAt: true },
        })
      : null
    const monthsBack = 6 + ((i * 7) % 13) // 6..18
    const horizon = addDays(r.lastCheckAt, -Math.round(monthsBack * 30.4))
    const pair = [names[i % 4]!, names[(i + 1) % 4]!]

    let date = r.lastCheckAt
    let n = 0
    while (date >= horizon && date <= today) {
      if (latest && new Date(date + 'T00:00:00Z') <= latest.startedAt) break
      const kind = n % 4 === 3 ? 'technical_maintenance' : 'functional_check'
      const startedAt = new Date(
        `${date}T${String(8 + ((i + n) % 9)).padStart(2, '0')}:${n % 2 ? '30' : '00'}:00+03:00`,
      )
      const endedAt = new Date(
        startedAt.getTime() + (kind === 'functional_check' ? 25 : 55) * 60_000,
      )
      const techs = n % 5 === 4 ? [pair[0]!] : pair
      await db.visit.create({
        data: {
          id: newId(),
          tenantId,
          elevatorId: r.row.id,
          buildingId: r.row.buildingId,
          kind,
          startedAt,
          endedAt,
          notes: kind === 'technical_maintenance' ? 'Планово техническо обслужване.' : null,
          source: 'paper',
          qualityFlags: techs.length < 2 ? ['singleTechnician'] : [],
          technicians: {
            create: techs.map((name, p) => ({
              id: newId(),
              tenantId,
              userId: userIdByName.get(name) ?? null,
              position: p + 1,
              name,
            })),
          },
        },
      })
      created++
      // An occasional repair a few days after a check.
      if ((i + n) % 7 === 6) {
        const repairDay = addDays(date, 3)
        if (repairDay <= today) {
          const at = new Date(`${repairDay}T14:00:00+03:00`)
          await db.visit.create({
            data: {
              id: newId(),
              tenantId,
              elevatorId: r.row.id,
              buildingId: r.row.buildingId,
              kind: 'repair',
              startedAt: at,
              endedAt: new Date(at.getTime() + 90 * 60_000),
              notes: REPAIR_NOTES[(i + n) % REPAIR_NOTES.length]!,
              source: 'paper',
              qualityFlags: [],
              technicians: {
                create: [{ id: newId(), tenantId, userId: null, position: 1, name: pair[1]! }],
              },
            },
          })
          created++
        }
      }
      n++
      date = addDays(date, -(r.interval + ((n % 3) - 1)))
    }
  }
  return created
}
