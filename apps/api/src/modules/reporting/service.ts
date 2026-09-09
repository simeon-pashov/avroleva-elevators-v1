import type {
  CalendarDto,
  CalendarItemDto,
  CalendarItemKind,
  CalendarQuery,
  DashboardDto,
  DashboardPinDto,
} from '@avroleva/contracts'
import { CalendarItemKind as CalendarItemKindEnum } from '@avroleva/contracts'
import type { Ctx } from '../../platform/http/ctx.js'
import {
  addDays,
  dateOnlyInSofia,
  fromDateOnly,
  monthBounds,
  toDateOnly,
  todayInSofia,
} from '../../platform/clock.js'
import * as visits from '../visits/index.js'
import { getTenantSettings } from '../tenancy/index.js'
import { elevators } from '../registry/index.js'
import { dueState } from '../maintenance/index.js'
import { summary } from '../billing/index.js'
import * as callbacks from '../callbacks/index.js'
import * as defects from '../defects/index.js'
import * as calendar from '../calendar/index.js'
import * as jobs from '../jobs/index.js'

/**
 * Dashboard = one registry read model query (elevators + buildings + contacts), the billing
 * summary, the open callbacks and open defects (each one query) and the 30-day deadline counts.
 * No per-pin queries.
 */
export async function dashboard(ctx: Ctx): Promise<DashboardDto> {
  const today = todayInSofia()
  const tomorrow = addDays(today, 1)
  const period = today.slice(0, 7)
  const { start, end } = monthBounds(period)
  const monthFrom = fromDateOnly(start)!
  const monthTo = fromDateOnly(addDays(end, 1))!
  const [rows, money, cb, df, deadlines, openCallbacks, monthVisits, monthCallbacks] =
    await Promise.all([
      elevators.listForSchedule(ctx.tenantId),
      summary(ctx.tenantId),
      callbacks.openSummary(ctx.tenantId),
      defects.openSummary(ctx.tenantId),
      calendarItems(ctx, { from: today, to: addDays(today, 30), includeOverdue: true }),
      callbacks.openByElevator(ctx.tenantId),
      visits.countInPeriod(ctx.tenantId, monthFrom, monthTo),
      callbacks.list(ctx, { limit: 200, from: start, to: addDays(end, 1) }),
    ])
  const responses = monthCallbacks.items
    .map((c) => c.responseMinutes)
    .filter((m): m is number => m != null)
  const counts = {
    elevators: 0,
    overdue: 0,
    today: 0,
    tomorrow: 0,
    soon: 0,
    ok: 0,
    stopped: 0,
    none: 0,
    buildingsOnMap: 0,
    buildingsWithoutCoordinates: 0,
  }
  const onMap = new Set<string>()
  const noCoords = new Set<string>()
  const pins: DashboardPinDto[] = []
  for (const r of rows) {
    counts.elevators++
    const next = toDateOnly(r.nextCheckDueAt)
    const state = dueState(next, r.status, today)
    counts[state]++
    if (next === tomorrow && r.status === 'active') counts.tomorrow++
    if (r.building.lat == null || r.building.lng == null) {
      noCoords.add(r.buildingId)
      continue
    }
    onMap.add(r.buildingId)
    pins.push({
      elevatorId: r.id,
      buildingId: r.buildingId,
      lat: r.building.lat,
      lng: r.building.lng,
      label: `${r.building.addressText} · ${r.internalNo}`,
      addressText: r.building.addressText,
      internalNo: r.internalNo,
      status: r.status,
      state,
      nextCheckDueAt: next,
      stopLift: df.stopLiftElevatorIds.has(r.id),
      openCallbacks: openCallbacks.get(r.id)?.length ?? 0,
    })
  }
  counts.buildingsOnMap = onMap.size
  counts.buildingsWithoutCoordinates = noCoords.size
  const byKind = emptyCounts()
  let overdue = 0
  for (const it of deadlines.items) {
    byKind[it.kind]++
    if (it.severity === 'overdue') overdue++
  }
  return {
    today,
    counts,
    money: {
      pendingCents: money.pendingCents,
      pendingCount: money.pendingCount,
      overdueCents: money.overdueCents,
      overdueCount: money.overdueCount,
      paidThisMonthCents: money.paidThisMonthCents,
    },
    callbacks: cb,
    defects: {
      open: df.open,
      stopLift: df.stopLift,
      awaitingApproval: df.awaitingApproval,
      followUpDue: df.followUpDue,
    },
    deadlines: { days: 30, overdue, total: deadlines.items.length, byKind },
    thisMonth: {
      period,
      visits: monthVisits,
      callbacks: monthCallbacks.items.length,
      avgResponseMinutes: responses.length
        ? Math.round(responses.reduce((a, b) => a + b, 0) / responses.length)
        : null,
    },
    pins,
  }
}

function emptyCounts(): Record<CalendarItemKind, number> {
  return Object.fromEntries(CalendarItemKindEnum.options.map((k) => [k, 0])) as Record<
    CalendarItemKind,
    number
  >
}

/**
 * The deadlines view: one merged list of everything with a date - inspections due
 * (elevator.nextInspectionAt or a scheduled inspection), periodic checks overdue, defect
 * follow-ups, open callbacks over the limit, alarm-device tests due. Computed on read (the nightly
 * `calendar_item` materialisation comes with pg-boss); the window is [from, to] plus, by default,
 * everything already overdue.
 */
export async function calendarItems(
  ctx: Ctx,
  q: { from?: string; to?: string; kinds?: CalendarItemKind[]; includeOverdue?: boolean },
): Promise<CalendarDto> {
  const today = todayInSofia()
  const from = q.from ?? today
  const to = q.to ?? addDays(from, 30)
  const includeOverdue = q.includeOverdue ?? true
  const wanted = new Set<CalendarItemKind>(q.kinds ?? CalendarItemKindEnum.options)
  const settings = await getTenantSettings(ctx.tenantId)
  const rules = calendar.rulesFor(settings)
  const t = ctx.t

  const [rows, scheduled, openDefects, overSla, lastTests, awaitingJobs] = await Promise.all([
    elevators.listForSchedule(ctx.tenantId),
    wanted.has('inspection_due') ? calendar.scheduledRows(ctx.tenantId) : Promise.resolve([]),
    wanted.has('defect_follow_up') ? defects.listOpenRows(ctx.tenantId) : Promise.resolve([]),
    wanted.has('callback_sla') ? callbacks.openOverSla(ctx.tenantId) : Promise.resolve([]),
    wanted.has('alarm_test_due') && rules.alarmTestIntervalMonths
      ? calendar.latestAlarmTests(ctx.tenantId)
      : Promise.resolve(new Map<string, Date>()),
    wanted.has('job_approval') ? jobs.awaitingApprovalRows(ctx.tenantId) : Promise.resolve([]),
  ])
  const byElevator = new Map(rows.map((r) => [r.id, r]))
  const scheduledByElevator = new Map<string, (typeof scheduled)[number]>()
  for (const s of scheduled) {
    const prev = scheduledByElevator.get(s.elevatorId)
    if (!prev || (s.scheduledAt && prev.scheduledAt && s.scheduledAt < prev.scheduledAt))
      scheduledByElevator.set(s.elevatorId, s)
  }

  const items: CalendarItemDto[] = []
  const push = (
    kind: CalendarItemKind,
    refType: CalendarItemDto['refType'],
    refId: string,
    elevatorId: string,
    dueAt: string,
    title: string,
  ) => {
    const e = byElevator.get(elevatorId)
    if (!e) return
    const severity = calendar.severityOf(dueAt, today, rules)
    const inWindow = dueAt >= from && dueAt <= to
    if (!inWindow && !(includeOverdue && severity === 'overdue')) return
    items.push({
      id: `${kind}:${refId}`,
      kind,
      refType,
      refId,
      elevatorId,
      elevatorInternalNo: e.internalNo,
      buildingId: e.buildingId,
      buildingAddressText: e.building.addressText,
      dueAt,
      inDays: calendar.daysBetween(today, dueAt),
      severity,
      title,
    })
  }

  const inService = rows.filter((r) => r.status !== 'scrapped' && r.status !== 'out_of_contract')
  if (wanted.has('inspection_due')) {
    for (const r of inService) {
      const sched = scheduledByElevator.get(r.id)
      if (sched?.scheduledAt) {
        push(
          'inspection_due',
          'inspection',
          sched.id,
          r.id,
          toDateOnly(sched.scheduledAt)!,
          t('calendar.item.inspectionScheduled', {
            kind: t(`enum.inspectionKind.${sched.kind}`),
          }),
        )
      } else if (r.nextInspectionAt) {
        push(
          'inspection_due',
          'elevator',
          r.id,
          r.id,
          toDateOnly(r.nextInspectionAt)!,
          t('calendar.item.inspectionDue'),
        )
      }
    }
  }
  if (wanted.has('check_overdue')) {
    for (const r of inService) {
      const next = toDateOnly(r.nextCheckDueAt)
      if (r.status === 'active' && next && next < today)
        push('check_overdue', 'elevator', r.id, r.id, next, t('calendar.item.checkOverdue'))
    }
  }
  if (wanted.has('defect_follow_up')) {
    for (const d of openDefects) {
      const ref = defects.toDefectDto(d, today).catalogRef
      push(
        'defect_follow_up',
        'defect',
        d.id,
        d.elevatorId,
        toDateOnly(d.followUpDueAt)!,
        t('calendar.item.defectFollowUp', {
          what: ref ? `${ref} · ${d.description}` : d.description,
        }),
      )
    }
  }
  if (wanted.has('callback_sla')) {
    for (const c of overSla) {
      push(
        'callback_sla',
        'callback',
        c.id,
        c.elevatorId,
        dateOnlyInSofia(new Date(c.receivedAt.getTime() + c.slaMinutes * 60_000)),
        t('calendar.item.callbackSla', { minutes: c.slaMinutes }),
      )
    }
  }
  if (wanted.has('alarm_test_due') && rules.alarmTestIntervalMonths) {
    for (const r of inService) {
      if (r.status !== 'active') continue
      const last = lastTests.get(r.id)
      const dueAt = last
        ? calendar.addMonthsDateOnly(dateOnlyInSofia(last), rules.alarmTestIntervalMonths)
        : today
      push('alarm_test_due', 'elevator', r.id, r.id, dueAt, t('calendar.item.alarmTestDue'))
    }
  }

  if (wanted.has('job_approval')) {
    for (const { job, dueAt } of awaitingJobs) {
      push(
        'job_approval',
        'job',
        job.id,
        job.elevatorId,
        dateOnlyInSofia(dueAt),
        t('calendar.item.jobApproval', { title: job.title }),
      )
    }
  }

  items.sort((a, b) => (a.dueAt < b.dueAt ? -1 : a.dueAt > b.dueAt ? 1 : a.id.localeCompare(b.id)))
  const counts = { ...emptyCounts(), overdue: 0, total: items.length }
  for (const it of items) {
    counts[it.kind]++
    if (it.severity === 'overdue') counts.overdue++
  }
  return { today, from, to, items, counts }
}

export function calendarFromQuery(ctx: Ctx, q: CalendarQuery): Promise<CalendarDto> {
  return calendarItems(ctx, {
    from: q.from,
    to: q.to,
    kinds: q.kinds,
    includeOverdue: q.includeOverdue,
  })
}
