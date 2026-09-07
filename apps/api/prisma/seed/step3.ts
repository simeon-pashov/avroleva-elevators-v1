import { prismaBase as db } from '../../src/platform/db/prisma.js'
import { newId } from '../../src/platform/ids.js'
import { addDays, fromDateOnly } from '../../src/platform/clock.js'
import { addMonthsDateOnly } from '../../src/modules/calendar/index.js'
import { defectCatalog } from '@avroleva/domain-data'
import type {
  CallbackClassification,
  CallbackChannel,
  ElevatorStatus,
} from '../../src/generated/prisma/index.js'

/**
 * Step 3 demo data: callbacks with realistic timelines (some over the 60-minute limit), open
 * defects (two stop-lift ones on the already-stopped elevators), an inspection per elevator with
 * the next date spread over the next 14 months (a few overdue), alarm-device tests. Idempotent:
 * callbacks / defects / alarm tests are only created when the tenant has none; inspections are
 * upserted per elevator so the dates stay relative to "today" on every run.
 */
export interface SeedElevator {
  id: string
  buildingId: string
  internalNo: string
  status: ElevatorStatus
}

interface CallbackSeed {
  daysAgo: number
  hour: number
  classification: CallbackClassification
  channel: CallbackChannel
  responseMin: number | null
  onSiteMin: number
  description: string
  cause: string
  action: string
  chargeable?: boolean
  trapped?: number
  open?: boolean
}

const CALLBACKS: CallbackSeed[] = [
  {
    daysAgo: 118,
    hour: 9,
    classification: 'breakdown',
    channel: 'phone',
    responseMin: 32,
    onSiteMin: 40,
    description: 'Асансьорът не тръгва от партера.',
    cause: 'Изгорял предпазител в таблото.',
    action: 'Сменен предпазител, проверено управление.',
  },
  {
    daysAgo: 104,
    hour: 19,
    classification: 'trapped_persons',
    channel: 'phone',
    responseMin: 24,
    onSiteMin: 30,
    description: 'Заседнали двама души между 4 и 5 етаж.',
    cause: 'Задействан ограничител на скоростта при спиране на тока.',
    action: 'Освободени пътници, рестартирано управление.',
    trapped: 2,
  },
  {
    daysAgo: 97,
    hour: 14,
    classification: 'complaint',
    channel: 'office',
    responseMin: 85,
    onSiteMin: 25,
    description: 'Силен шум при движение нагоре.',
    cause: 'Износени ролки на кабинните врати.',
    action: 'Регулирани ролки; планирана смяна.',
  },
  {
    daysAgo: 88,
    hour: 7,
    classification: 'breakdown',
    channel: 'phone',
    responseMin: 41,
    onSiteMin: 55,
    description: 'Вратите не се затварят на 2 етаж.',
    cause: 'Чуждо тяло в прага на шахтната врата.',
    action: 'Почистен праг, проверени контакти.',
    chargeable: true,
  },
  {
    daysAgo: 80,
    hour: 22,
    classification: 'trapped_persons',
    channel: 'public_page',
    responseMin: 68,
    onSiteMin: 20,
    description: 'Заседнал човек, кабината е между етажи.',
    cause: 'Прекъснато захранване в сградата.',
    action: 'Освободен пътник; асансьорът върнат в експлоатация след възстановяване на тока.',
    trapped: 1,
  },
  {
    daysAgo: 71,
    hour: 11,
    classification: 'breakdown',
    channel: 'phone',
    responseMin: 19,
    onSiteMin: 90,
    description: 'Асансьорът спира на всеки етаж.',
    cause: 'Дефектен бутон за повикване на 3 етаж (залепнал).',
    action: 'Сменен бутон.',
  },
  {
    daysAgo: 63,
    hour: 16,
    classification: 'other',
    channel: 'office',
    responseMin: null,
    onSiteMin: 0,
    description: 'Домоуправителят пита за мигащо осветление.',
    cause: 'Проверено по телефона – стартер на лампата.',
    action: 'Ще се смени при следващата проверка.',
  },
  {
    daysAgo: 55,
    hour: 8,
    classification: 'breakdown',
    channel: 'phone',
    responseMin: 122,
    onSiteMin: 45,
    description: 'Не работи изобщо, няма светлина в кабината.',
    cause: 'Паднал автоматичен предпазител на осветлението.',
    action: 'Възстановено захранване.',
  },
  {
    daysAgo: 47,
    hour: 13,
    classification: 'complaint',
    channel: 'public_page',
    responseMin: 50,
    onSiteMin: 30,
    description: 'Неточно спиране на етаж – стъпало ~5 cm.',
    cause: 'Разрегулирани нивелиращи сензори.',
    action: 'Регулирано спиране.',
  },
  {
    daysAgo: 39,
    hour: 20,
    classification: 'trapped_persons',
    channel: 'phone',
    responseMin: 28,
    onSiteMin: 25,
    description: 'Заседнал възрастен човек на 6 етаж.',
    cause: 'Задействан стоп-бутон в кабината.',
    action: 'Освободен пътник, инструктирани живущите.',
    trapped: 1,
  },
  {
    daysAgo: 30,
    hour: 10,
    classification: 'breakdown',
    channel: 'phone',
    responseMin: 37,
    onSiteMin: 120,
    description: 'Шум и удар при потегляне.',
    cause: 'Разхлабен болт на спирачката.',
    action: 'Затегнат и регулиран спирачен механизъм.',
  },
  {
    daysAgo: 22,
    hour: 15,
    classification: 'breakdown',
    channel: 'office',
    responseMin: 95,
    onSiteMin: 35,
    description: 'Вратата на партера не се отваря докрай.',
    cause: 'Вандализъм – огъната водеща шина.',
    action: 'Изправена шина, планирана смяна.',
    chargeable: true,
  },
  {
    daysAgo: 14,
    hour: 9,
    classification: 'complaint',
    channel: 'phone',
    responseMin: 44,
    onSiteMin: 20,
    description: 'Мирише на изгоряло в кабината.',
    cause: 'Прегрял трансформатор на осветлението.',
    action: 'Сменен трансформатор.',
  },
  {
    daysAgo: 7,
    hour: 18,
    classification: 'trapped_persons',
    channel: 'public_page',
    responseMin: 21,
    onSiteMin: 15,
    description: 'Заседнал човек с дете.',
    cause: 'Спиране на тока в квартала.',
    action: 'Освободени пътници.',
    trapped: 2,
  },
  {
    daysAgo: 2,
    hour: 12,
    classification: 'breakdown',
    channel: 'phone',
    responseMin: 57,
    onSiteMin: 60,
    description: 'Асансьорът не отговаря на повикване от 1 етаж.',
    cause: 'Дефектен етажен пост.',
    action: 'Сменен етажен пост.',
  },
  // Open right now: one dispatched 20 minutes ago, one still unassigned and already over the limit.
  {
    daysAgo: 0,
    hour: -1,
    classification: 'breakdown',
    channel: 'phone',
    responseMin: null,
    onSiteMin: 0,
    description: 'Асансьорът е спрял между 2 и 3 етаж, няма заседнали.',
    cause: '',
    action: '',
    open: true,
  },
  {
    daysAgo: 0,
    hour: -2,
    classification: 'complaint',
    channel: 'public_page',
    responseMin: null,
    onSiteMin: 0,
    description: 'Вратите се затварят много рязко.',
    cause: '',
    action: '',
    open: true,
  },
]

export async function seedStep3(
  tenantId: string,
  elevators: SeedElevator[],
  today: string,
): Promise<Record<string, number>> {
  const counts = { callbacks: 0, defects: 0, inspections: 0, alarmTests: 0 }
  const ivan = await db.user.findUnique({ where: { username: 'ivan' }, select: { id: true } })
  const demo = await db.user.findUnique({ where: { username: 'demo' }, select: { id: true } })
  const active = elevators.filter((e) => e.status === 'active')
  const stopped = elevators.filter(
    (e) => e.status === 'stopped_by_firm' || e.status === 'stopped_by_authority',
  )
  const now = new Date()

  // Demo tenant: flags on, alarm-test cadence tracked (settings merge keeps the rest).
  const tenant = await db.tenant.findUnique({ where: { id: tenantId } })
  if (tenant) {
    const settings = { ...(tenant.settings as object), alarmTestIntervalMonths: 6 }
    const features = { ...(tenant.features as object), publicQrPage: true, publicFaultReport: true }
    await db.tenant.update({ where: { id: tenantId }, data: { settings, features } })
  }

  // ---- callbacks
  if ((await db.callback.count({ where: { tenantId } })) === 0 && active.length > 0) {
    for (const [i, c] of CALLBACKS.entries()) {
      const e = active[(i * 5) % active.length]!
      const receivedAt = c.open
        ? new Date(
            now.getTime() - Math.abs(c.hour) * 60 * 60 * 1000 + (i % 2 ? 40 : 20) * 60 * 1000,
          )
        : new Date(
            `${addDays(today, -c.daysAgo)}T${String(c.hour).padStart(2, '0')}:${String((i * 17) % 60).padStart(2, '0')}:00+03:00`,
          )
      const dispatchedAt = c.open
        ? i % 2 === 0
          ? null
          : new Date(receivedAt.getTime() + 3 * 60 * 1000)
        : c.responseMin != null
          ? new Date(receivedAt.getTime() + Math.min(5, c.responseMin) * 60 * 1000)
          : null
      const onSiteAt =
        c.open || c.responseMin == null
          ? null
          : new Date(receivedAt.getTime() + c.responseMin * 60 * 1000)
      const releasedAt =
        onSiteAt && c.classification === 'trapped_persons'
          ? new Date(onSiteAt.getTime() + 8 * 60 * 1000)
          : null
      const restoredAt = onSiteAt ? new Date(onSiteAt.getTime() + c.onSiteMin * 60 * 1000) : null
      const closedAt = c.open
        ? null
        : new Date((restoredAt ?? receivedAt).getTime() + (onSiteAt ? 5 : 15) * 60 * 1000)
      const assigned = c.open
        ? dispatchedAt
          ? ivan?.id
          : null
        : c.responseMin != null
          ? (ivan?.id ?? null)
          : null
      const id = newId()
      let closeoutVisitId: string | null = null
      if (closedAt && onSiteAt) {
        closeoutVisitId = newId()
        await db.visit.create({
          data: {
            id: closeoutVisitId,
            tenantId,
            elevatorId: e.id,
            buildingId: e.buildingId,
            kind: 'callback',
            startedAt: onSiteAt,
            endedAt: closedAt,
            notes: `${c.cause} — ${c.action}`,
            source: 'office',
            qualityFlags: ['singleTechnician'],
            createdByUserId: demo?.id ?? null,
            technicians: {
              create: [
                {
                  id: newId(),
                  tenantId,
                  userId: ivan?.id ?? null,
                  position: 1,
                  name: 'Иван Петров',
                },
              ],
            },
          },
        })
      }
      const status = c.open ? (dispatchedAt ? 'dispatched' : 'open') : 'closed'
      await db.callback.create({
        data: {
          id,
          tenantId,
          elevatorId: e.id,
          buildingId: e.buildingId,
          channel: c.channel,
          callerName:
            c.channel === 'office'
              ? null
              : ['Мария Петрова', 'Георги Илиев', 'Живущ от ап. 14', 'Стефка Николова'][i % 4]!,
          callerPhone:
            c.channel === 'office'
              ? null
              : ['0888 123 456', '0887 222 333', null, '0898 444 555'][i % 4]!,
          classification: c.classification,
          trappedCount: c.trapped ?? null,
          description: c.description,
          status,
          receivedAt,
          dispatchedAt,
          onSiteAt,
          releasedAt,
          restoredAt,
          closedAt,
          assignedUserId: assigned ?? null,
          cause: c.open ? null : c.cause,
          actionTaken: c.open ? null : c.action,
          chargeable: !!c.chargeable,
          chargeReason: c.chargeable ? (i % 2 ? 'vandalism' : 'misuse') : null,
          slaMinutes: 60,
          closeoutVisitId,
          source: c.channel === 'public_page' ? 'public' : 'office',
          createdByUserId: c.channel === 'public_page' ? null : (demo?.id ?? null),
          events: {
            create: [
              {
                id: newId(),
                tenantId,
                type: 'opened',
                at: receivedAt,
                receivedAt,
                source: c.channel === 'public_page' ? 'public' : 'office',
                byUserId: c.channel === 'public_page' ? null : (demo?.id ?? null),
                data: { channel: c.channel },
              },
              ...(dispatchedAt
                ? [
                    {
                      id: newId(),
                      tenantId,
                      type: 'dispatched',
                      at: dispatchedAt,
                      receivedAt: dispatchedAt,
                      source: 'office' as const,
                      byUserId: demo?.id ?? null,
                      data: { userId: ivan?.id },
                    },
                  ]
                : []),
              ...(onSiteAt
                ? [
                    {
                      id: newId(),
                      tenantId,
                      type: 'on_site',
                      at: onSiteAt,
                      receivedAt: onSiteAt,
                      source: 'office' as const,
                      byUserId: ivan?.id ?? null,
                      data: {},
                    },
                  ]
                : []),
              ...(releasedAt
                ? [
                    {
                      id: newId(),
                      tenantId,
                      type: 'released',
                      at: releasedAt,
                      receivedAt: releasedAt,
                      source: 'office' as const,
                      byUserId: ivan?.id ?? null,
                      data: {},
                    },
                  ]
                : []),
              ...(restoredAt
                ? [
                    {
                      id: newId(),
                      tenantId,
                      type: 'restored',
                      at: restoredAt,
                      receivedAt: restoredAt,
                      source: 'office' as const,
                      byUserId: ivan?.id ?? null,
                      data: {},
                    },
                  ]
                : []),
              ...(closedAt
                ? [
                    {
                      id: newId(),
                      tenantId,
                      type: 'closed',
                      at: closedAt,
                      receivedAt: closedAt,
                      source: 'office' as const,
                      byUserId: demo?.id ?? null,
                      data: { cause: c.cause, chargeable: !!c.chargeable },
                    },
                  ]
                : []),
            ],
          },
        },
      })
      counts.callbacks++
    }
  }

  // ---- defects
  if ((await db.defect.count({ where: { tenantId } })) === 0) {
    const item = (code: string) => defectCatalog.items.find((i) => i.code === code)!
    const mk = async (
      e: SeedElevator,
      d: {
        code: string | null
        description?: string
        daysAgo: number
        status: 'open' | 'notified' | 'awaiting_approval' | 'scheduled' | 'resolved'
        severity?: 'low' | 'medium' | 'high'
        stopLift?: boolean
        source?: 'visit' | 'callback' | 'office'
      },
    ) => {
      const recordedAt = new Date(`${addDays(today, -d.daysAgo)}T10:30:00+03:00`)
      const cat = d.code ? item(d.code) : null
      await db.defect.create({
        data: {
          id: newId(),
          tenantId,
          elevatorId: e.id,
          buildingId: e.buildingId,
          catalogCode: cat?.code ?? null,
          description: d.description ?? cat?.bg ?? '',
          severity: d.severity ?? (cat && cat.code !== 'other' ? 'high' : 'medium'),
          stopLift: d.stopLift ?? cat?.stopLift ?? false,
          status: d.status,
          recordedAt,
          sourceType: d.source ?? 'visit',
          followUpDueAt: fromDateOnly(addDays(today, -d.daysAgo + 30))!,
          noticeSentAt: ['notified', 'awaiting_approval', 'scheduled', 'resolved'].includes(
            d.status,
          )
            ? new Date(recordedAt.getTime() + 24 * 60 * 60 * 1000)
            : null,
          customerRequestedAt: ['awaiting_approval', 'scheduled', 'resolved'].includes(d.status)
            ? new Date(recordedAt.getTime() + 5 * 24 * 60 * 60 * 1000)
            : null,
          resolvedAt:
            d.status === 'resolved'
              ? new Date(recordedAt.getTime() + 12 * 24 * 60 * 60 * 1000)
              : null,
          createdByUserId: demo?.id ?? null,
        },
      })
      counts.defects++
    }
    // Two stop-lift defects on the elevators the seed already keeps stopped.
    if (stopped[0]) await mk(stopped[0], { code: '17', daysAgo: 12, status: 'notified' })
    if (stopped[1]) await mk(stopped[1], { code: '7', daysAgo: 40, status: 'awaiting_approval' })
    else if (stopped[0])
      await mk(stopped[0], { code: '7', daysAgo: 40, status: 'awaiting_approval' })
    // Four open non-stop-lift defects, one of them past its follow-up date.
    const a = active
    if (a[0])
      await mk(a[0], {
        code: 'other',
        description: 'Пукнато огледало в кабината.',
        daysAgo: 3,
        status: 'open',
        severity: 'low',
        source: 'visit',
      })
    if (a[3])
      await mk(a[3], {
        code: 'other',
        description: 'Износен под на кабината, повдигнат ръб.',
        daysAgo: 20,
        status: 'notified',
        source: 'visit',
      })
    if (a[6])
      await mk(a[6], {
        code: 'other',
        description: 'Корозия по вратата на машинното помещение.',
        daysAgo: 38,
        status: 'awaiting_approval',
        severity: 'low',
        source: 'office',
      })
    if (a[9])
      await mk(a[9], {
        code: 'other',
        description: 'Слаб звук на аварийния звънец.',
        daysAgo: 10,
        status: 'scheduled',
        source: 'callback',
      })
    // Two resolved ones for the history.
    if (a[1]) await mk(a[1], { code: '11', daysAgo: 75, status: 'resolved', stopLift: true })
    if (a[4])
      await mk(a[4], {
        code: 'other',
        description: 'Скърцане на кабинната врата.',
        daysAgo: 50,
        status: 'resolved',
        severity: 'low',
      })
  }

  // ---- inspections: one performed periodic inspection per elevator, next due spread over 14 months
  const inService = elevators.filter((e) => e.status !== 'scrapped')
  for (const [i, e] of inService.entries()) {
    // -60 .. +365 days; every 5th one overdue.
    const offset = i % 5 === 0 ? -(10 + ((i * 13) % 50)) : (i * 37) % 420
    const nextDue = addDays(today, offset)
    const performedAt = addMonthsDateOnly(nextDue, -12)
    const existing = await db.inspection.findFirst({
      where: { tenantId, elevatorId: e.id, kind: 'periodic', performedAt: { not: null } },
    })
    const result = i % 7 === 3 ? 'passed_with_defects' : 'passed'
    const defects =
      result === 'passed_with_defects'
        ? [
            {
              text: 'Да се подмени осветителното тяло в машинното.',
              deadline: addDays(performedAt, 60),
              closed: true,
            },
            {
              text: 'Да се обозначи товароподемността на видно място.',
              deadline: addDays(performedAt, 30),
              closed: false,
            },
          ]
        : []
    const data = {
      performedAt: fromDateOnly(performedAt),
      nextDueAt: fromDateOnly(nextDue),
      result,
      defects,
      inspectionBody: ['ОТП „Лифтконтрол“', 'ОТП „Технотест“', 'ОТП „Сертех“'][i % 3]!,
      notes: null,
    } as const
    if (existing) {
      await db.inspection.update({ where: { id: existing.id }, data })
    } else {
      await db.inspection.create({
        data: {
          id: newId(),
          tenantId,
          elevatorId: e.id,
          kind: 'periodic',
          createdByUserId: demo?.id ?? null,
          ...data,
        },
      })
      counts.inspections++
    }
    await db.elevator.update({
      where: { id: e.id },
      data: { nextInspectionAt: fromDateOnly(nextDue) },
    })
  }
  // Two scheduled (pending) inspections in the next three weeks.
  if ((await db.inspection.count({ where: { tenantId, performedAt: null } })) === 0) {
    for (const [j, e] of [inService[2], inService[7]].entries()) {
      if (!e) continue
      await db.inspection.create({
        data: {
          id: newId(),
          tenantId,
          elevatorId: e.id,
          kind: j === 0 ? 'periodic' : 'after_repair',
          requestedAt: fromDateOnly(addDays(today, -6)),
          scheduledAt: fromDateOnly(addDays(today, 5 + j * 9)),
          result: 'pending',
          inspectionBody: 'ОТП „Лифтконтрол“',
          createdByUserId: demo?.id ?? null,
        },
      })
      counts.inspections++
    }
  }

  // ---- alarm-device tests (roughly half the elevators, 1-5 months ago; one failed)
  if ((await db.alarmDeviceTest.count({ where: { tenantId } })) === 0) {
    for (const [i, e] of active.entries()) {
      if (i % 2 === 1) continue
      const monthsAgo = 1 + (i % 5)
      await db.alarmDeviceTest.create({
        data: {
          id: newId(),
          tenantId,
          elevatorId: e.id,
          testedAt: new Date(`${addMonthsDateOnly(today, -monthsAgo)}T11:00:00+03:00`),
          ok: i !== 4,
          notes: i === 4 ? 'Слаб сигнал, SIM картата е за подмяна.' : null,
          byUserId: ivan?.id ?? null,
        },
      })
      counts.alarmTests++
    }
  }

  return counts
}
