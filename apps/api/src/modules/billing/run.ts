import { systemActorOf, systemCtx } from '../../platform/http/ctx.js'
import { audit } from '../../platform/audit.js'
import { todayInSofia } from '../../platform/clock.js'
import { getTenant, getTenantSettings } from '../tenancy/index.js'
import { runTargetFor } from './domain/cycle.js'
import { effectiveBilling, generate } from './service.js'

export interface RunResult {
  period: string
  due: boolean
  enabled: boolean
  created: number
  skipped: number
}

/**
 * The scheduled billing run (ADR 0001 section 5): from the tenant's run day the current month's
 * invoices are generated for every active contract; contracts with their own anchorDay wait for
 * it. Idempotent: `generate` skips existing (contract, period) pairs, so the daily tick after the
 * run day creates nothing new, and a run missed on the day itself catches up on the next tick.
 */
export async function runScheduled(tenantId: string, today = todayInSofia()): Promise<RunResult> {
  const settings = await getTenantSettings(tenantId)
  const eff = effectiveBilling(settings)
  const target = runTargetFor(today, eff.runDay)
  if (!eff.runEnabled || !target.due) {
    return {
      period: target.period,
      due: target.due,
      enabled: eff.runEnabled,
      created: 0,
      skipped: 0,
    }
  }
  const tenant = await getTenant(tenantId)
  const ctx = systemCtx(tenantId, tenant.locale, 'billing.run')
  const r = await generate(ctx, target.period, { asOf: today, actor: systemActorOf(tenantId) })
  if (r.created > 0) {
    await audit(systemActorOf(tenantId), {
      action: 'billing.run',
      entityType: 'tenant',
      entityId: tenantId,
      after: { period: target.period, created: r.created, skipped: r.skipped, today },
    })
  }
  return { period: target.period, due: true, enabled: true, created: r.created, skipped: r.skipped }
}
