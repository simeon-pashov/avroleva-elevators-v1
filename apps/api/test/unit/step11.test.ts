import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { mergePatch, patchOf, tenantSettings, updateTenantBody } from '@avroleva/contracts'

/**
 * QA 2026-09-10 (step 11): a settings page that saved only its own block reset every other block
 * to the defaults (bank details, payment provider, jobs, planning), because `patchOf()` left zod 4
 * `.prefault()`s in place and they fire even behind `.optional()`; the service then shallow-merged.
 */
describe('patchOf strips defaults and prefaults at every level', () => {
  it('an absent prefaulted object stays undefined (no defaults materialise)', () => {
    const schema = patchOf(
      z.object({
        a: z.number().default(1),
        block: z.object({ x: z.string().default('x'), y: z.number().default(2) }).prefault({}),
      }),
    )
    expect(schema.parse({})).toEqual({})
    expect(schema.parse({ block: { y: 5 } })).toEqual({ block: { y: 5 } })
  })
  it('the tenant settings patch body keeps billing / jobs / planning out when they are not sent', () => {
    const body = updateTenantBody.parse({ settings: { planning: { avgStopMinutes: 21 } } })
    expect(body.settings).toEqual({ planning: { avgStopMinutes: 21 } })
    const billingOnly = updateTenantBody.parse({
      settings: { billing: { paymentProvider: 'demo' } },
    })
    expect(billingOnly.settings).toEqual({ billing: { paymentProvider: 'demo' } })
  })
  it('bankCsvMapping stays a whole object (nullable wrapper, not deep-partial)', () => {
    const shape = patchOf(tenantSettings).shape.billing
    const billing = (shape as z.ZodOptional<z.ZodObject<z.ZodRawShape>>).unwrap()
    expect(() => billing.parse({ bankCsvMapping: { delimiter: ';' } })).toThrow()
    expect(billing.parse({ bankCsvMapping: null })).toEqual({ bankCsvMapping: null })
  })
})

describe('mergePatch', () => {
  const current = {
    n: 1,
    billing: {
      runDay: 5,
      bank: { iban: 'BG1', bic: 'B' },
      provider: 'demo',
      mapping: { a: 1, b: 2 },
    },
    list: [1, 2],
  }
  it('merges nested plain objects and replaces scalars, arrays and null', () => {
    const out = mergePatch(current, {
      billing: { runDay: 6, bank: { bic: 'C' }, mapping: { c: 3 } },
      list: [9],
    })
    expect(out).toEqual({
      n: 1,
      billing: {
        runDay: 6,
        bank: { iban: 'BG1', bic: 'C' },
        provider: 'demo',
        mapping: { a: 1, b: 2, c: 3 },
      },
      list: [9],
    })
    expect(mergePatch(current, { billing: { bank: null } }).billing.bank).toBeNull()
    expect(mergePatch(current, { n: undefined })).toEqual(current)
    expect(mergePatch(current, undefined)).toBe(current)
  })
  it('does not mutate the stored object', () => {
    const copy = JSON.parse(JSON.stringify(current))
    mergePatch(current, { billing: { runDay: 7 } })
    expect(current).toEqual(copy)
  })
  it('tenant settings survive a re-parse after a partial patch', () => {
    const stored = tenantSettings.parse({
      billing: {
        runDay: 5,
        paymentProvider: 'demo',
        bank: {
          beneficiary: 'X',
          iban: 'BG80BNBG96611020345678',
          bic: 'BNBGBGSD',
          bankName: 'BNB',
        },
      },
      jobs: { quoteValidDays: 45 },
    })
    const patch = updateTenantBody.parse({
      settings: { planning: { avgStopMinutes: 21 } },
    }).settings
    const merged = tenantSettings.parse(mergePatch(stored, patch))
    expect(merged.billing.paymentProvider).toBe('demo')
    expect(merged.billing.bank.iban).toBe('BG80BNBG96611020345678')
    expect(merged.jobs.quoteValidDays).toBe(45)
    expect(merged.planning.avgStopMinutes).toBe(21)
  })
})
