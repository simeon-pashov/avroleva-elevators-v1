import { prismaBase as db } from '../platform/db/prisma.js'
import { newId } from '../platform/ids.js'
import { addDays, todayInSofia } from '../platform/clock.js'
import { systemActorOf, systemCtx } from '../platform/http/ctx.js'
import * as billing from '../modules/billing/index.js'

/**
 * A year of money for a demo tenant (ADR 0001 section 6): invoices for the last `months`
 * periods through the billing module (gapless numbering, payer references), then a believable
 * mix: most old invoices paid on time (some through a "bank statement" import with references),
 * a few buildings chronically late, partial payments and one over-payment, two credit notes,
 * a couple of unallocated payments, and dunning stages reached over time - by replaying the
 * dunning job week by week across the year, so the history looks lived-in.
 */
export interface DemoBillingResult {
  invoices: number
  payments: number
  creditNotes: number
  bankImports: number
  dunningStages: number
}

function addMonthsToPeriod(period: string, months: number): string {
  const [y, m] = period.split('-').map(Number) as [number, number]
  const d = new Date(Date.UTC(y, m - 1 + months, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export async function seedDemoBilling(
  tenantId: string,
  buildingIds: Map<string, string>,
  today: string = todayInSofia(),
  months = 12,
): Promise<DemoBillingResult> {
  const owner = await db.user.findFirst({
    where: { tenantId, role: 'owner', isActive: true, deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })
  const tenant = await db.tenant.findUnique({ where: { id: tenantId } })
  const ctx = { ...systemCtx(tenantId, tenant?.locale ?? 'bg', 'demo'), userId: owner?.id ?? '' }
  const actor = systemActorOf(tenantId)
  const out: DemoBillingResult = {
    invoices: 0,
    payments: 0,
    creditNotes: 0,
    bankImports: 0,
    dunningStages: 0,
  }

  const periods: string[] = []
  for (let k = months - 1; k >= 0; k--) periods.push(addMonthsToPeriod(today.slice(0, 7), -k))
  for (const p of periods) out.invoices += (await billing.generate(ctx, p, { actor })).created

  const keyOfBuilding = new Map([...buildingIds.entries()].map(([k, v]) => [v, k]))
  const behind = new Set(['b3', 'b5', 'b9']) // chronically late: the last two months open, dunned
  const early = new Set(['b7', 'b12']) // already paid the current month
  const viaBank = new Set(['b1', 'b2', 'b4', 'b6', 'b7', 'b8', 'b10', 'b12']) // paid by transfer
  const partial = new Set(['b11']) // paid half of last month
  const all = await billing.list(ctx, { limit: 200 })
  const customerName = new Map(all.items.map((i) => [i.id, i.customerName ?? '']))

  interface Planned {
    inv: (typeof all.items)[number]
    paidAt: string
    amountCents: number
    bank: boolean
    method: 'bank' | 'other'
  }
  const planned: Planned[] = []
  for (const inv of all.items) {
    if (inv.openCents <= 0) continue
    const key = keyOfBuilding.get(inv.buildingId) ?? 'b1'
    const idx = Number(key.slice(1))
    const k = periods.indexOf(inv.period) // 0 = oldest .. months-1 = current
    const age = periods.length - 1 - k // 0 = current month
    let pay = false
    let amount = inv.openCents
    if (age >= 3) pay = true
    else if (age === 2) pay = !behind.has(key) || key === 'b9'
    else if (age === 1) {
      pay = !behind.has(key)
      if (partial.has(key)) amount = Math.round(inv.openCents / 2)
    } else pay = early.has(key)
    if (!pay) continue
    // Late payers pay 5-25 days after due; the rest a few days around the due date.
    const lateDays = behind.has(key) ? 5 + ((idx * 7) % 20) : (idx % 5) - 2
    const paidAt = addDays(inv.dueAt, lateDays)
    if (paidAt > today) continue
    planned.push({
      inv,
      paidAt,
      amountCents: amount,
      bank: viaBank.has(key),
      method: idx % 3 === 0 ? 'other' : 'bank',
    })
  }
  planned.sort((a, b) => a.paidAt.localeCompare(b.paidAt))

  // Replay the year week by week: dunning runs on the "day", payments land on their day.
  const start = addDays(`${periods[0]}-01`, 0)
  let cursor = start
  let planIdx = 0
  const bankRows: Array<{ p: Planned; paymentId: string }> = []
  while (cursor <= today) {
    while (planIdx < planned.length && planned[planIdx]!.paidAt <= cursor) {
      const p = planned[planIdx]!
      const r = await billing.recordPayment(
        ctx,
        {
          invoiceId: p.inv.id,
          buildingId: p.inv.buildingId,
          amountCents: p.amountCents,
          paidAt: p.paidAt,
          method: p.bank ? 'bank' : p.method,
          note: null,
          reference: p.inv.paymentReference,
          source: p.bank ? 'bank_import' : 'manual',
          counterparty: p.bank ? customerName.get(p.inv.id) || null : null,
        },
        actor,
      )
      out.payments++
      if (p.bank) bankRows.push({ p, paymentId: r.payment.id })
      planIdx++
    }
    const d = await billing.runDunning(tenantId, cursor)
    out.dunningStages += d.reached
    cursor = addDays(cursor, 7)
  }
  // Anything left on the plan (paid "today").
  for (; planIdx < planned.length; planIdx++) {
    const p = planned[planIdx]!
    const r = await billing.recordPayment(
      ctx,
      {
        invoiceId: p.inv.id,
        buildingId: p.inv.buildingId,
        amountCents: p.amountCents,
        paidAt: p.paidAt,
        method: p.bank ? 'bank' : p.method,
        note: null,
        reference: p.inv.paymentReference,
        source: p.bank ? 'bank_import' : 'manual',
        counterparty: p.bank ? customerName.get(p.inv.id) || null : null,
      },
      actor,
    )
    out.payments++
    if (p.bank) bankRows.push({ p, paymentId: r.payment.id })
  }

  // The bank-transfer payments become one committed "bank statement" import (last 3 months).
  const recentBank = bankRows.filter((b) => b.p.paidAt >= addDays(today, -92))
  if (recentBank.length > 0 && (await db.bankImport.count({ where: { tenantId } })) === 0) {
    await db.bankImport.create({
      data: {
        id: newId(),
        tenantId,
        filename: `izvlechenie-${addDays(today, -92)}-${today}.csv`,
        status: 'committed',
        mapping: {
          delimiter: ';',
          hasHeader: true,
          dateColumn: 0,
          debitColumn: 2,
          creditColumn: 3,
          counterpartyColumn: 5,
          descriptionColumn: 6,
          referenceColumn: 7,
          dateFormat: 'DD.MM.YYYY',
          decimalSeparator: ',',
          skipRows: 0,
        },
        rowCount: recentBank.length + 1,
        matchedCount: recentBank.length,
        bookedCount: recentBank.length,
        createdByUserId: owner?.id ?? null,
        committedAt: new Date(`${today}T09:15:00+03:00`),
        rows: {
          create: [
            ...recentBank.map((b, i) => ({
              id: newId(),
              tenantId,
              position: i + 1,
              bookedAt: new Date(`${b.p.paidAt}T00:00:00Z`),
              amountCents: b.p.amountCents,
              counterparty: customerName.get(b.p.inv.id) ?? '',
              description: `${b.p.inv.paymentReference} асансьорна поддръжка ${b.p.inv.period}`,
              reference: b.p.inv.paymentReference,
              matchKind: i % 4 === 3 ? ('amount_name' as const) : ('reference' as const),
              invoiceId: b.p.inv.id,
              buildingId: b.p.inv.buildingId,
              paymentId: b.paymentId,
              status: 'booked' as const,
            })),
            {
              id: newId(),
              tenantId,
              position: recentBank.length + 1,
              bookedAt: new Date(`${addDays(today, -3)}T00:00:00Z`),
              amountCents: 4200,
              counterparty: 'ЕТ „Петров и син“',
              description: 'превод',
              reference: null,
              matchKind: 'none' as const,
              invoiceId: null,
              buildingId: null,
              paymentId: null,
              status: 'unallocated' as const,
            },
          ],
        },
      },
    })
    out.bankImports = 1
  }

  // Two credit notes for the history: a goodwill discount and a wrongly billed lift.
  if ((await db.creditNote.count({ where: { tenantId } })) === 0) {
    const candidates = all.items.filter(
      (i) => periods.indexOf(i.period) === 1 || periods.indexOf(i.period) === 4,
    )
    const fresh = await billing.list(ctx, { limit: 200 })
    let n = 0
    for (const c of candidates) {
      const inv = fresh.items.find((i) => i.id === c.id)
      if (!inv || inv.openCents <= 0 || n >= 2) continue
      await billing.issueCreditNote(ctx, inv.id, {
        totalCents: Math.min(inv.openCents, Math.round(inv.totalCents / 4)),
        reason: n === 0 ? 'Отстъпка за прекъснато обслужване' : 'Грешно фактуриран асансьор',
        issuedAt: addDays(inv.dueAt, 2) > today ? today : addDays(inv.dueAt, 2),
      })
      out.creditNotes++
      n++
    }
  }

  // Two unallocated payments (advance / rounding) and one over-payment, only once.
  const extra = [
    { key: 'b1', amountCents: 2000, method: 'other' as const, note: 'Аванс от домоуправителя' },
    { key: 'b7', amountCents: 10000, method: 'bank' as const, note: 'Превод без посочена фактура' },
  ]
  for (const x of extra) {
    const buildingId = buildingIds.get(x.key)
    if (!buildingId) continue
    const exists = await db.payment.findFirst({ where: { tenantId, buildingId, invoiceId: null } })
    if (exists) continue
    await billing.createPayment(ctx, {
      buildingId,
      amountCents: x.amountCents,
      paidAt: addDays(today, -4),
      method: x.method,
      note: x.note,
      reference: null,
    })
    out.payments++
  }
  return out
}
