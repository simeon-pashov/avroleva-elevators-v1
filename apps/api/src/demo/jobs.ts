import { prismaBase as db } from '../platform/db/prisma.js'
import { addDays } from '../platform/clock.js'
import { systemCtx } from '../platform/http/ctx.js'
import type { Ctx } from '../platform/http/ctx.js'
import * as jobs from '../modules/jobs/index.js'
import type { JobLineInput } from '@avroleva/contracts'
import { wireModules } from '../wiring.js'

/**
 * Demo repair jobs (step 8): ~25 jobs across the year in mixed stages with realistic Bulgarian
 * line items, through the jobs module (stages, events, audit, the repair visit and the invoice
 * happen as in the app), then back-dated so the board looks lived-in. Idempotent: only when the
 * tenant has no jobs.
 */
type Stage =
  | 'draft'
  | 'quoted'
  | 'awaiting_approval'
  | 'approved'
  | 'scheduled'
  | 'in_progress'
  | 'done'
  | 'invoiced'
  | 'rejected'
  | 'cancelled'

interface JobSeed {
  daysAgo: number
  kind: 'repair' | 'modernisation' | 'other'
  title: string
  description: string
  stage: Stage
  lines: JobLineInput[]
  origin?: 'defect' | 'callback' | 'visit' | 'office'
  deposit?: boolean
}

const L = (
  kind: 'labour' | 'part' | 'other',
  description: string,
  qty: number,
  unitCents: number,
  partRef?: string,
): JobLineInput => ({ kind, description, qty, unitCents, partRef: partRef ?? null })

const SEEDS: JobSeed[] = [
  {
    daysAgo: 340,
    kind: 'repair',
    title: 'Смяна на ролки на кабинните врати',
    description: 'Износени ролки, вратите заяждат при затваряне.',
    stage: 'invoiced',
    origin: 'visit',
    lines: [
      L('part', 'Ролка за кабинна врата Ø60', 4, 2850, 'RL-60'),
      L('labour', 'Труд – демонтаж, монтаж и регулиране', 3, 4500),
    ],
  },
  {
    daysAgo: 322,
    kind: 'repair',
    title: 'Подмяна на носещи въжета',
    description: 'Въжетата са с прекъснати нишки над допустимото.',
    stage: 'invoiced',
    origin: 'defect',
    lines: [
      L('part', 'Стоманено въже 8 mm, 6×19', 240, 420, 'ST-8-619'),
      L('part', 'Клиновидни закрепвания (комплект)', 8, 3200),
      L('labour', 'Труд – смяна на въжета, 2 техници', 12, 4500),
    ],
  },
  {
    daysAgo: 300,
    kind: 'repair',
    title: 'Смяна на контактор на главния двигател',
    description: 'Контакторът залепва, асансьорът спира между етажите.',
    stage: 'invoiced',
    origin: 'callback',
    lines: [
      L('part', 'Контактор 3P 40A 230V', 1, 9800, 'LC1D40'),
      L('labour', 'Труд – подмяна и проверка', 2, 4500),
    ],
  },
  {
    daysAgo: 280,
    kind: 'modernisation',
    title: 'Честотен регулатор за главния двигател',
    description: 'Плавно потегляне и спиране; намален шум.',
    stage: 'invoiced',
    origin: 'office',
    deposit: true,
    lines: [
      L('part', 'Честотен регулатор 7.5 kW с енкодер', 1, 189000, 'FRQ-7.5'),
      L('part', 'Спирачен резистор и кабели', 1, 21000),
      L('labour', 'Труд – монтаж, настройка и изпитание', 16, 4500),
    ],
  },
  {
    daysAgo: 262,
    kind: 'repair',
    title: 'Ремонт на етажен пост, 5 ет.',
    description: 'Счупен бутон и разбит корпус.',
    stage: 'invoiced',
    origin: 'callback',
    lines: [L('part', 'Етажен пост с бутон и индикация', 1, 6400), L('labour', 'Труд', 1, 4500)],
  },
  {
    daysAgo: 240,
    kind: 'repair',
    title: 'Смяна на спирачни накладки',
    description: 'Спирачката буксува при пълен товар.',
    stage: 'invoiced',
    origin: 'visit',
    lines: [
      L('part', 'Спирачни накладки (комплект)', 1, 14500, 'BR-K2'),
      L('labour', 'Труд – регулиране на спирачката', 3, 4500),
    ],
  },
  {
    daysAgo: 215,
    kind: 'repair',
    title: 'Подмяна на кабинно осветление с LED',
    description: 'Изгоряло осветление, старите луминесцентни тела.',
    stage: 'invoiced',
    origin: 'office',
    lines: [
      L('part', 'LED панел за кабина 24V', 2, 3900),
      L('part', 'Аварийно осветление с батерия', 1, 5600),
      L('labour', 'Труд', 1.5, 4500),
    ],
  },
  {
    daysAgo: 190,
    kind: 'repair',
    title: 'Ремонт на автоматична шахтна врата, 2 ет.',
    description: 'Вратата не се заключва докрай.',
    stage: 'invoiced',
    origin: 'defect',
    lines: [
      L('part', 'Ключалка за шахтна врата с контакт', 1, 7200, 'LK-12'),
      L('part', 'Ролки на шахтна врата', 2, 2400),
      L('labour', 'Труд', 2.5, 4500),
    ],
  },
  {
    daysAgo: 168,
    kind: 'repair',
    title: 'Смяна на буфери в шахтната яма',
    description: 'Буферите са корозирали.',
    stage: 'rejected',
    origin: 'visit',
    lines: [L('part', 'Полиуретанов буфер', 2, 8800), L('labour', 'Труд', 2, 4500)],
  },
  {
    daysAgo: 150,
    kind: 'repair',
    title: 'Подмяна на кабинни врати (двукрилни)',
    description: 'Деформирани крила след удар с количка.',
    stage: 'invoiced',
    origin: 'callback',
    deposit: true,
    lines: [
      L('part', 'Кабинна врата, двукрилна централна 800 mm', 1, 168000),
      L('part', 'Задвижване на кабинна врата', 1, 74000),
      L('labour', 'Труд – демонтаж, монтаж, настройка', 14, 4500),
    ],
  },
  {
    daysAgo: 130,
    kind: 'repair',
    title: 'Смяна на ограничител на скоростта',
    description: 'Ограничителят не задейства при изпитание.',
    stage: 'invoiced',
    origin: 'defect',
    lines: [
      L('part', 'Ограничител на скоростта 1.0 m/s', 1, 46000, 'OS-10'),
      L('part', 'Обтегач с контакт', 1, 9800),
      L('labour', 'Труд и изпитание', 6, 4500),
    ],
  },
  {
    daysAgo: 110,
    kind: 'repair',
    title: 'Ремонт на честотен регулатор – вентилатор',
    description: 'Прегрява, спира с грешка OH.',
    stage: 'done',
    origin: 'callback',
    lines: [
      L('part', 'Вентилатор за честотен регулатор', 1, 5200),
      L('labour', 'Труд – почистване и подмяна', 2, 4500),
    ],
  },
  {
    daysAgo: 96,
    kind: 'modernisation',
    title: 'Подмяна на командно табло',
    description: 'Релейно табло без резервни части.',
    stage: 'cancelled',
    origin: 'office',
    lines: [
      L('part', 'Микропроцесорно командно табло, 8 спирки', 1, 420000),
      L('part', 'Кабели и етажни постове', 1, 68000),
      L('labour', 'Труд – монтаж и пускане', 40, 4500),
    ],
  },
  {
    daysAgo: 80,
    kind: 'repair',
    title: 'Смяна на редукторно масло и уплътнения',
    description: 'Теч на масло от редуктора.',
    stage: 'done',
    origin: 'visit',
    lines: [
      L('part', 'Редукторно масло 20 l', 1, 18000),
      L('part', 'Уплътнения (комплект)', 1, 6500),
      L('labour', 'Труд', 4, 4500),
    ],
  },
  {
    daysAgo: 66,
    kind: 'repair',
    title: 'Подмяна на кабинен оператор',
    description: 'Индикацията в кабината не свети.',
    stage: 'done',
    origin: 'callback',
    lines: [L('part', 'Кабинен оператор с дисплей', 1, 32000), L('labour', 'Труд', 2, 4500)],
  },
  {
    daysAgo: 52,
    kind: 'repair',
    title: 'Смяна на въжета на ограничителя',
    description: 'Въжето на ограничителя е износено.',
    stage: 'in_progress',
    origin: 'defect',
    lines: [L('part', 'Въже 6 mm за ограничител', 60, 380), L('labour', 'Труд', 4, 4500)],
  },
  {
    daysAgo: 45,
    kind: 'repair',
    title: 'Ремонт на аварийната връзка (GSM)',
    description: 'Кабинният телефон не набира.',
    stage: 'in_progress',
    origin: 'visit',
    lines: [
      L('part', 'GSM модул за аварийна връзка', 1, 24000),
      L('labour', 'Труд и настройка', 2, 4500),
    ],
  },
  {
    daysAgo: 38,
    kind: 'repair',
    title: 'Смяна на носещ пружинен амортисьор',
    description: 'Шум при спиране на горна спирка.',
    stage: 'scheduled',
    origin: 'callback',
    lines: [L('part', 'Амортисьор', 2, 4200), L('labour', 'Труд', 2, 4500)],
  },
  {
    daysAgo: 31,
    kind: 'repair',
    title: 'Подмяна на етажни бутони – всички етажи',
    description: 'Осем етажни поста със счупени бутони.',
    stage: 'scheduled',
    origin: 'office',
    lines: [L('part', 'Етажен бутон с подсветка', 8, 1900), L('labour', 'Труд', 4, 4500)],
  },
  {
    daysAgo: 27,
    kind: 'repair',
    title: 'Смяна на контактор и реле за посока',
    description: 'Асансьорът не тръгва нагоре.',
    stage: 'approved',
    origin: 'callback',
    lines: [
      L('part', 'Контактор 3P 25A', 2, 6800, 'LC1D25'),
      L('part', 'Реле за посока', 1, 2400),
      L('labour', 'Труд', 2, 4500),
    ],
  },
  {
    daysAgo: 24,
    kind: 'modernisation',
    title: 'Честотен регулатор и енкодер',
    description: 'Модернизация на задвижването.',
    stage: 'awaiting_approval',
    origin: 'office',
    lines: [
      L('part', 'Честотен регулатор 11 kW', 1, 236000, 'FRQ-11'),
      L('part', 'Енкодер и монтажен комплект', 1, 28000),
      L('labour', 'Труд – монтаж и изпитание', 20, 4500),
    ],
  },
  {
    daysAgo: 20,
    kind: 'repair',
    title: 'Подмяна на шахтни врати, 1–4 ет.',
    description: 'Ръчни врати с износени панти и ключалки.',
    stage: 'awaiting_approval',
    origin: 'defect',
    lines: [
      L('part', 'Шахтна врата, ръчна, 700 mm', 4, 58000),
      L('part', 'Ключалка с контакт', 4, 7200),
      L('labour', 'Труд', 16, 4500),
    ],
  },
  {
    daysAgo: 9,
    kind: 'repair',
    title: 'Смяна на ролки на противотежестта',
    description: 'Шум по време на движение.',
    stage: 'awaiting_approval',
    origin: 'visit',
    lines: [L('part', 'Ролка на противотежест', 4, 3100), L('labour', 'Труд', 3, 4500)],
  },
  {
    daysAgo: 5,
    kind: 'repair',
    title: 'Ремонт на спирачен електромагнит',
    description: 'Спирачката се освобождава със закъснение.',
    stage: 'quoted',
    origin: 'callback',
    lines: [L('part', 'Бобина за спирачен електромагнит', 1, 17500), L('labour', 'Труд', 3, 4500)],
  },
  {
    daysAgo: 2,
    kind: 'repair',
    title: 'Подмяна на кабинен под',
    description: 'Настилката е напукана.',
    stage: 'draft',
    origin: 'office',
    lines: [
      L('part', 'Настилка за кабина, алуминиева рифелна', 1, 21000),
      L('labour', 'Труд', 3, 4500),
    ],
  },
]

const EVIDENCE = ['assembly_protocol', 'email', 'viber', 'verbal', 'manager_signature'] as const

export async function seedJobs(
  tenantId: string,
  elevatorRows: Array<{ id: string; buildingId: string; status: string }>,
  today: string,
): Promise<{ jobs: number; jobInvoices: number }> {
  wireModules()
  await jobs.ensureSystemJobStages()
  if ((await db.job.count({ where: { tenantId } })) > 0) return { jobs: 0, jobInvoices: 0 }
  if (elevatorRows.length === 0) return { jobs: 0, jobInvoices: 0 }
  const owner = await db.user.findFirst({
    where: { tenantId, role: 'owner', isActive: true, deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })
  const techs = await db.user.findMany({
    where: { tenantId, role: 'technician', isActive: true, deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })
  const tenant = await db.tenant.findUnique({ where: { id: tenantId } })
  const ctx: Ctx = {
    ...systemCtx(tenantId, tenant?.locale ?? 'bg', 'demo'),
    userId: owner?.id ?? '',
  }
  const techIds = techs.map((t) => t.id)
  const pair = (i: number) =>
    techIds.length === 0
      ? []
      : techIds.length === 1
        ? [techIds[0]!]
        : [techIds[i % techIds.length]!, techIds[(i + 1) % techIds.length]!]
  // Never in the future: the services refuse timestamps ahead of the clock.
  const ceiling = Date.now() - 60 * 60_000
  const at = (daysAgo: number, hour = 9) => {
    const d = new Date(`${addDays(today, -daysAgo)}T${String(hour).padStart(2, '0')}:00:00+03:00`)
    return d.getTime() > ceiling ? new Date(ceiling) : d
  }
  // A scheduled date may lie ahead (the office plans next week).
  const ahead = (daysAhead: number, hour = 9) =>
    new Date(`${addDays(today, daysAhead)}T${String(hour).padStart(2, '0')}:00:00+03:00`)

  let created = 0
  let invoices = 0
  for (const [i, s] of SEEDS.entries()) {
    const el = elevatorRows[(i * 5) % elevatorRows.length]!
    // Origins point at a real record of the same elevator when one exists.
    let originId: string | null = null
    if (s.origin === 'defect')
      originId =
        (
          await db.defect.findFirst({
            where: { tenantId, elevatorId: el.id },
            select: { id: true },
          })
        )?.id ?? null
    if (s.origin === 'callback')
      originId =
        (
          await db.callback.findFirst({
            where: { tenantId, elevatorId: el.id },
            select: { id: true },
          })
        )?.id ?? null
    if (s.origin === 'visit')
      originId =
        (
          await db.visit.findFirst({
            where: { tenantId, elevatorId: el.id },
            orderBy: { startedAt: 'desc' },
            select: { id: true },
          })
        )?.id ?? null
    const job = await jobs.create(ctx, {
      elevatorId: el.id,
      kind: s.kind,
      title: s.title,
      description: s.description,
      originType: originId ? s.origin! : 'office',
      originId,
      lines: s.lines,
      notes: null,
    })
    created++
    const createdAt = at(s.daysAgo)
    const stamps: Record<string, Date> = { createdAt }
    const stageOrder: Stage[] = [
      'draft',
      'quoted',
      'awaiting_approval',
      'approved',
      'scheduled',
      'in_progress',
      'done',
      'invoiced',
    ]
    const target = s.stage
    const reach = (st: Stage) =>
      target === st ||
      (stageOrder.includes(target) && stageOrder.indexOf(target) >= stageOrder.indexOf(st))
    if (target === 'rejected' || target === 'cancelled' || reach('quoted')) {
      await jobs.markQuoted(ctx, job.id)
      stamps.quotedAt = at(s.daysAgo - 1)
    }
    if (target === 'rejected' || reach('awaiting_approval')) {
      await jobs.sendQuote(ctx, job.id, { channel: 'none' })
      stamps.quoteSentAt = at(s.daysAgo - 2, 11)
    }
    if (target === 'rejected') {
      await jobs.reject(ctx, job.id, { reason: 'Общото събрание отложи ремонта за догодина.' })
    } else if (target === 'cancelled') {
      await jobs.cancel(ctx, job.id, { reason: 'Сградата смени поддържащата фирма.' })
    } else {
      if (reach('approved')) {
        const kind = EVIDENCE[i % EVIDENCE.length]!
        await jobs.transition(ctx, job.id, {
          to: 'approved',
          evidence: {
            kind,
            by: 'домоуправител',
            note: kind === 'assembly_protocol' ? 'Протокол № ' + (12 + i) : null,
            at: at(s.daysAgo - 6, 18).toISOString(),
          },
        })
        stamps.approvedAt = at(s.daysAgo - 6, 18)
      }
      if (reach('scheduled')) {
        const when = target === 'scheduled' ? ahead(2 + (i % 5), 9) : at(s.daysAgo - 9, 9)
        const who = pair(i)
        if (who.length)
          await jobs.schedule(ctx, job.id, {
            scheduledAt: when.toISOString(),
            assignedUserIds: who,
            notes: null,
          })
        else await jobs.transition(ctx, job.id, { to: 'in_progress' })
        stamps.scheduledAt = when
      }
      if (reach('in_progress')) {
        const when = target === 'in_progress' ? at(0, 8) : at(s.daysAgo - 9, 9)
        await jobs.start(ctx, job.id, { at: when.toISOString() })
        stamps.startedAt = when
      }
      if (reach('done')) {
        const when = at(s.daysAgo - 9, 13 + (i % 4))
        await jobs.complete(ctx, job.id, {
          at: when.toISOString(),
          notes: 'Работата е извършена и изпитана; асансьорът е пуснат в експлоатация.',
          partsUsed: s.lines
            .filter((l) => l.kind === 'part')
            .map((l) => l.description)
            .join(', '),
          attachments: [],
          createVisit: true,
        })
        stamps.completedAt = when
      }
      if (s.deposit && reach('approved') && job.customerId) {
        const first = s.lines[0]!
        await jobs.invoice(ctx, job.id, {
          kind: 'partial',
          amountCents: Math.round(first.qty * first.unitCents * 0.5),
          issuedAt: addDays(today, -(s.daysAgo - 7)),
        })
        invoices++
      }
      if (reach('invoiced') && job.customerId) {
        await jobs.invoice(ctx, job.id, {
          kind: 'full',
          issuedAt: addDays(today, -(s.daysAgo - 10)),
        })
        invoices++
      }
    }
    // Back-date so the board and the "money leaking" widget look lived-in.
    await db.job.update({
      where: { id: job.id },
      data: {
        createdAt: stamps.createdAt,
        updatedAt:
          stamps.completedAt ??
          stamps.startedAt ??
          stamps.scheduledAt ??
          stamps.approvedAt ??
          stamps.quoteSentAt ??
          stamps.createdAt,
        ...(stamps.quoteSentAt ? { quoteSentAt: stamps.quoteSentAt } : {}),
      },
    })
  }
  return { jobs: created, jobInvoices: invoices }
}
