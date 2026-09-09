import { prismaBase as db } from '../platform/db/prisma.js'
import { newId } from '../platform/ids.js'
import { zones } from '../modules/registry/index.js'

/**
 * Demo zones and technician pair (step 9): two polygon zones that split Sofia at lng 23.33
 * ("Изток" holds Младост / Дружба / Гео Милев, "Запад" holds Люлин / Надежда / Красно село /
 * Овча купел), one pair "Екип 1" of the seeded technicians with the east zone as its home, then
 * the default zone assignment of every building. Idempotent: zones only when the tenant has no
 * zone of its own, the pair only when it has none.
 */
const EAST = {
  type: 'Polygon',
  coordinates: [
    [
      [23.33, 42.6],
      [23.48, 42.6],
      [23.48, 42.74],
      [23.33, 42.74],
      [23.33, 42.6],
    ],
  ],
}
const WEST = {
  type: 'Polygon',
  coordinates: [
    [
      [23.2, 42.6],
      [23.33, 42.6],
      [23.33, 42.76],
      [23.2, 42.76],
      [23.2, 42.6],
    ],
  ],
}

export async function seedPlanning(
  tenantId: string,
): Promise<{ zones: number; pairs: number; zonedBuildings: number }> {
  const counts = { zones: 0, pairs: 0, zonedBuildings: 0 }
  let east = await db.zone.findFirst({
    where: { tenantId, deletedAt: null, isDefault: false, name: 'Изток' },
  })
  const ownZones = await db.zone.count({ where: { tenantId, deletedAt: null, isDefault: false } })
  if (ownZones === 0) {
    east = await db.zone.create({
      data: {
        id: newId(),
        tenantId,
        name: 'Изток',
        colour: '#2563eb',
        polygon: EAST,
        districts: ['Младост 1', 'Младост 3', 'Дружба 1', 'Гео Милев'],
        position: 0,
      },
    })
    await db.zone.create({
      data: {
        id: newId(),
        tenantId,
        name: 'Запад',
        colour: '#16a34a',
        polygon: WEST,
        districts: ['Люлин 5', 'Люлин 7', 'Надежда 2', 'Красно село', 'Овча купел 1'],
        position: 1,
      },
    })
    counts.zones = 2
  }
  const pairs = await db.technicianPair.count({ where: { tenantId, deletedAt: null } })
  if (pairs === 0) {
    const techs = await db.user.findMany({
      where: { tenantId, role: 'technician', isActive: true, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
      take: 3,
    })
    if (techs.length > 0) {
      await db.technicianPair.create({
        data: {
          id: newId(),
          tenantId,
          name: 'Екип 1',
          userIds: techs.slice(0, 2).map((t) => t.id),
          vehicle: 'СА 4521 РХ',
          defaultZoneId: east?.id ?? null,
          position: 0,
        },
      })
      counts.pairs = 1
    }
  }
  counts.zonedBuildings = (await zones.recomputeAll(tenantId)).changed
  return counts
}
