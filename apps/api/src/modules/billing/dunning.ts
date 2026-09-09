import type {
  BillingConfigDto,
  DunningPreviewDto,
  DunningStageDto,
  LateFeeRuleDto,
  LateFeeRuleInput,
  SaveDunningStagesBody,
} from '@avroleva/contracts'
import { billingDefaults } from '@avroleva/domain-data'
import type { Ctx } from '../../platform/http/ctx.js'
import { actorOf, systemActorOf } from '../../platform/http/ctx.js'
import { AppError } from '../../platform/http/errors.js'
import { audit } from '../../platform/audit.js'
import { clock, toDateOnly, todayInSofia } from '../../platform/clock.js'
import { events } from '../../platform/events/bus.js'
import { listPaymentProviders } from '../../platform/adapters/payments/index.js'
import { getTenant, getTenantFeatures, getTenantSettings } from '../tenancy/index.js'
import * as repo from './repo/billing.js'
import * as cfg from './repo/config.js'
import type { RuleRow, StageRow } from './repo/config.js'
import { lateFeeFor, nextStage, orderStages } from './domain/dunning.js'
import type { LateFeeRuleLike, StageLike } from './domain/dunning.js'
import { INVOICE_STATES, INVOICE_TRANSITIONS, openCentsOf } from './domain/states.js'
import { paymentReferenceFor } from './domain/reference.js'
import {
  applyLateFee,
  providerStateFor,
  rollStatuses,
  toInvoiceDto,
  withCustomerNames,
} from './service.js'

function toStageDto(s: StageRow): DunningStageDto {
  return {
    id: s.id,
    tenantId: s.tenantId,
    key: s.key,
    position: s.position,
    offsetDays: s.offsetDays,
    channel: s.channel,
    templateKey: s.templateKey,
    lateFeeRuleKey: s.lateFeeRuleKey,
    active: s.active,
  }
}

function toRuleDto(r: RuleRow): LateFeeRuleDto {
  return {
    id: r.id,
    tenantId: r.tenantId,
    key: r.key,
    kind: r.kind,
    amountCents: r.amountCents,
    percentBp: r.percentBp,
    graceDays: r.graceDays,
    capCents: r.capCents,
    enabled: r.enabled,
  }
}

/** Seeds: the system stages / rule from packages/domain-data (idempotent by key). */
export async function ensureSystemBillingDefaults(): Promise<{ stages: number; rules: number }> {
  let stages = 0
  let rules = 0
  for (const s of orderStages(billingDefaults.stages.map((d) => ({ ...d, active: true })))) {
    if (await cfg.ensureStage(null, s)) stages++
  }
  for (const r of billingDefaults.lateFeeRules) {
    if (await cfg.ensureRule(null, r)) rules++
  }
  return { stages, rules }
}

/** The tenant's own stages when it has any, else the system list (positions recomputed). */
export async function effectiveStages(
  tenantId: string,
): Promise<{ stages: StageRow[]; customised: boolean }> {
  const own = await cfg.stagesOf(tenantId)
  if (own.length > 0) return { stages: own, customised: true }
  return { stages: await cfg.stagesOf(null), customised: false }
}

/** Rules by key: the tenant's row shadows the system row with the same key. */
export async function effectiveRules(tenantId: string): Promise<Map<string, RuleRow>> {
  const [system, own] = await Promise.all([cfg.rulesOf(null), cfg.rulesOf(tenantId)])
  const map = new Map<string, RuleRow>()
  for (const r of system) map.set(r.key, r)
  for (const r of own) map.set(r.key, r)
  return map
}

export async function saveStages(
  ctx: Ctx,
  body: SaveDunningStagesBody,
): Promise<DunningStageDto[]> {
  const keys = new Set(body.stages.map((s) => s.key))
  if (keys.size !== body.stages.length) throw new AppError(400, 'billing.stages.duplicateKey')
  const rules = await effectiveRules(ctx.tenantId)
  for (const s of body.stages) {
    if (s.lateFeeRuleKey && !rules.has(s.lateFeeRuleKey))
      throw new AppError(400, 'billing.stages.unknownRule')
  }
  const ordered = orderStages(
    body.stages.map((s) => ({ ...s, lateFeeRuleKey: s.lateFeeRuleKey ?? null })),
  )
  const rows = await cfg.replaceStages(ctx.tenantId, ordered)
  await audit(actorOf(ctx), {
    action: 'billing.stages.save',
    entityType: 'tenant',
    entityId: ctx.tenantId,
    after: { stages: ordered.map((s) => `${s.key}:+${s.offsetDays}:${s.channel}`) },
  })
  return rows.map(toStageDto)
}

export async function saveLateFeeRule(
  ctx: Ctx,
  key: string,
  body: LateFeeRuleInput,
): Promise<LateFeeRuleDto> {
  const row = await cfg.upsertRule(ctx.tenantId, {
    key,
    kind: body.kind,
    amountCents: body.amountCents,
    percentBp: body.percentBp,
    graceDays: body.graceDays,
    capCents: body.capCents ?? null,
    enabled: body.enabled,
  })
  await audit(actorOf(ctx), {
    action: 'billing.lateFee.save',
    entityType: 'tenant',
    entityId: ctx.tenantId,
    after: { key, ...body },
  })
  return toRuleDto(row)
}

/** GET /billing/config: the state machine, stages, rules and providers as data for the UI. */
export async function config(ctx: Ctx): Promise<BillingConfigDto> {
  const [tenant, settings, features, stages, rules] = await Promise.all([
    getTenant(ctx.tenantId),
    getTenantSettings(ctx.tenantId),
    getTenantFeatures(ctx.tenantId),
    effectiveStages(ctx.tenantId),
    effectiveRules(ctx.tenantId),
  ])
  const selected = providerStateFor(settings, features)
  return {
    states: INVOICE_STATES,
    transitions: INVOICE_TRANSITIONS,
    stages: stages.stages.map(toStageDto),
    stagesCustomised: stages.customised,
    lateFeeRules: [...rules.values()].map(toRuleDto),
    providers: listPaymentProviders().map((p) => {
      const caps = p.capabilities()
      const demoOff = p.name === 'demo' && !features.demoMode
      return {
        name: p.name,
        enabled: demoOff ? false : caps.enabled,
        note: demoOff ? 'billing.provider.demoModeOff' : (caps.note ?? null),
        ...(p.name === selected.name ? { enabled: selected.enabled, note: selected.note } : {}),
      }
    }),
    referenceSample: paymentReferenceFor(tenant.eik, 1),
  }
}

function stageLike(s: StageRow): StageLike {
  return {
    key: s.key,
    position: s.position,
    offsetDays: s.offsetDays,
    channel: s.channel,
    templateKey: s.templateKey,
    lateFeeRuleKey: s.lateFeeRuleKey,
    active: s.active,
  }
}

function ruleLike(r: RuleRow | undefined): LateFeeRuleLike | null {
  return r
    ? {
        key: r.key,
        kind: r.kind,
        amountCents: r.amountCents,
        percentBp: r.percentBp,
        graceDays: r.graceDays,
        capCents: r.capCents,
        enabled: r.enabled,
      }
    : null
}

/**
 * The daily dunning job (ADR 0001): for every open invoice, the latest stage whose day has come
 * and that the invoice has not reached yet; the stage's late-fee rule (if enabled) adds an
 * adjustment; the invoice remembers the stage; one DunningStageReached event carries the stage's
 * channel and template so the notifications module renders the right text to the right people.
 */
export async function runDunning(
  tenantId: string,
  today = todayInSofia(),
): Promise<{ reached: number; lateFees: number; lateFeeCents: number }> {
  await rollStatuses(tenantId)
  const [{ stages }, rules] = await Promise.all([
    effectiveStages(tenantId),
    effectiveRules(tenantId),
  ])
  const likes = stages.map(stageLike)
  const out = { reached: 0, lateFees: 0, lateFeeCents: 0 }
  for (const inv of await repo.openInvoices(tenantId)) {
    const dunnable = {
      id: inv.id,
      dueAt: toDateOnly(inv.dueAt)!,
      openCents: openCentsOf(inv),
      totalCents: inv.totalCents,
      dunningStage: inv.dunningStage,
      lateFeeCents: inv.lateFeeCents,
    }
    const stage = nextStage(likes, dunnable, today)
    if (!stage) continue
    let fee = 0
    if (stage.lateFeeRuleKey) {
      fee = lateFeeFor(ruleLike(rules.get(stage.lateFeeRuleKey)), dunnable, today)
      if (fee > 0) {
        const a = await applyLateFee(tenantId, inv, fee, stage.key, `late fee · ${stage.key}`)
        if (a) {
          out.lateFees++
          out.lateFeeCents += fee
        } else fee = 0
      }
    }
    const now = clock.now()
    await repo.updateInvoice(tenantId, inv.id, {
      dunningStage: stage.position,
      dunningStageKey: stage.key,
      dunningAt: now,
    })
    await audit(systemActorOf(tenantId), {
      action: 'invoice.dunning',
      entityType: 'invoice',
      entityId: inv.id,
      before: { dunningStage: inv.dunningStage },
      after: { dunningStage: stage.position, stageKey: stage.key, lateFeeCents: fee },
    })
    await events.publish(
      { tenantId },
      {
        type: 'DunningStageReached',
        aggregateType: 'invoice',
        aggregateId: inv.id,
        payload: {
          number: inv.number,
          buildingId: inv.buildingId,
          stageKey: stage.key,
          stagePosition: stage.position,
          channel: stage.channel,
          templateKey: stage.templateKey,
          offsetDays: stage.offsetDays,
          lateFeeCents: fee,
          openCents: dunnable.openCents + fee,
          dueAt: dunnable.dueAt,
        },
      },
    )
    out.reached++
  }
  return out
}

/** What the next run would do (settings page "preview"). */
export async function preview(ctx: Ctx, today = todayInSofia()): Promise<DunningPreviewDto> {
  await rollStatuses(ctx.tenantId)
  const [{ stages }, rules] = await Promise.all([
    effectiveStages(ctx.tenantId),
    effectiveRules(ctx.tenantId),
  ])
  const likes = stages.map(stageLike)
  const rows = await repo.openInvoices(ctx.tenantId)
  const dtos = await withCustomerNames(
    ctx,
    rows.map((r) => toInvoiceDto(r, today)),
  )
  const items: DunningPreviewDto['items'] = []
  for (const inv of rows) {
    const dto = dtos.find((d) => d.id === inv.id)!
    const dunnable = {
      id: inv.id,
      dueAt: dto.dueAt,
      openCents: dto.openCents,
      totalCents: inv.totalCents,
      dunningStage: inv.dunningStage,
      lateFeeCents: inv.lateFeeCents,
    }
    const stage = nextStage(likes, dunnable, today)
    if (!stage) continue
    const fee = stage.lateFeeRuleKey
      ? lateFeeFor(ruleLike(rules.get(stage.lateFeeRuleKey)), dunnable, today)
      : 0
    items.push({
      invoiceId: inv.id,
      number: inv.number,
      buildingId: inv.buildingId,
      buildingAddressText: dto.buildingAddressText,
      customerName: dto.customerName,
      openCents: dto.openCents,
      dueAt: dto.dueAt,
      daysOverdue: dto.daysOverdue,
      currentStage: inv.dunningStage,
      nextStageKey: stage.key,
      nextStagePosition: stage.position,
      channel: stage.channel,
      lateFeeCents: fee,
    })
  }
  return { today, items }
}

/**
 * "Send a reminder now" from the invoices list: emits DunningStageReached with the stage the
 * invoice is in (or the first stage's template) without moving the stage counter.
 */
export async function remindNow(ctx: Ctx, invoiceIds: string[]): Promise<number> {
  if (invoiceIds.length === 0) return 0
  const { stages } = await effectiveStages(ctx.tenantId)
  const rows = await repo.findInvoices(ctx.tenantId, invoiceIds)
  let n = 0
  for (const inv of rows) {
    if (openCentsOf(inv) <= 0) continue
    const stage = stages.find((s) => s.position === inv.dunningStage) ?? stages[0] ?? null
    await events.publish(ctx, {
      type: 'DunningStageReached',
      aggregateType: 'invoice',
      aggregateId: inv.id,
      payload: {
        number: inv.number,
        buildingId: inv.buildingId,
        stageKey: 'manual',
        stagePosition: inv.dunningStage,
        channel: stage?.channel ?? 'email',
        templateKey: stage?.templateKey ?? 'dunning_reminder',
        offsetDays: null,
        lateFeeCents: 0,
        openCents: openCentsOf(inv),
        dueAt: toDateOnly(inv.dueAt),
        manual: true,
      },
    })
    await audit(actorOf(ctx), {
      action: 'invoice.remind',
      entityType: 'invoice',
      entityId: inv.id,
      after: { stageKey: 'manual', templateKey: stage?.templateKey ?? 'dunning_reminder' },
    })
    n++
  }
  return n
}
