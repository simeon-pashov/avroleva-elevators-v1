import { describe, expect, it } from 'vitest'
import {
  PaymentMethod,
  bulkInvoiceBody,
  createBuildingBody,
  createContractBody,
  createElevatorBody,
  createPaymentBody,
  createUserBody,
  loginBody,
  payInvoiceBody,
  registerTenantBody,
  tenantSettings,
} from '@avroleva/contracts'

const uuid = '019b0f6a-7c2e-7c8a-8d3f-1a2b3c4d5e6f'

describe('registry validation (zod contracts)', () => {
  it('elevator: stops 2..60, defaults, nullable clears', () => {
    const ok = createElevatorBody.parse({
      buildingId: uuid,
      internalNo: 'вх. А',
      stops: 8,
      regNo: '',
      year: '',
    })
    expect(ok.driveType).toBe('electric')
    expect(ok.status).toBe('active')
    expect(ok.regNo).toBeNull()
    expect(ok.year).toBeNull()
    expect(() =>
      createElevatorBody.parse({ buildingId: uuid, internalNo: 'x', stops: 1 }),
    ).toThrow()
    expect(() =>
      createElevatorBody.parse({ buildingId: 'nope', internalNo: 'x', stops: 5 }),
    ).toThrow()
    expect(() =>
      createElevatorBody.parse({
        buildingId: uuid,
        internalNo: 'x',
        stops: 5,
        lastCheckAt: '31.12.2025',
      }),
    ).toThrow()
    expect(
      createElevatorBody.parse({
        buildingId: uuid,
        internalNo: 'x',
        stops: 5,
        lastCheckAt: '2025-12-31',
      }).lastCheckAt,
    ).toBe('2025-12-31')
  })

  it('building: city required, coordinates ranged', () => {
    expect(() => createBuildingBody.parse({ address: { city: '' } })).toThrow()
    expect(() =>
      createBuildingBody.parse({ address: { city: 'София' }, lat: 95, lng: 23 }),
    ).toThrow()
    const b = createBuildingBody.parse({
      address: { city: 'София', block: '25' },
      lat: 42.6,
      lng: 23.3,
    })
    expect(b.lat).toBe(42.6)
  })

  it('contract: at least one line, integer cents', () => {
    expect(() =>
      createContractBody.parse({
        customerId: uuid,
        buildingId: uuid,
        startDate: '2026-01-01',
        lines: [],
      }),
    ).toThrow()
    expect(() =>
      createContractBody.parse({
        customerId: uuid,
        buildingId: uuid,
        startDate: '2026-01-01',
        lines: [{ elevatorId: uuid, monthlyPriceCents: 55.5 }],
      }),
    ).toThrow()
    const c = createContractBody.parse({
      customerId: uuid,
      buildingId: uuid,
      startDate: '2026-01-01',
      lines: [{ elevatorId: uuid, monthlyPriceCents: 5500 }],
    })
    expect(c.status).toBe('active')
  })
})

describe('tenancy validation', () => {
  it('login: username lower-cased and trimmed', () => {
    expect(loginBody.parse({ username: '  Demo ', password: 'x' }).username).toBe('demo')
    expect(() => loginBody.parse({ username: 'ab', password: 'x' })).toThrow()
    expect(() => loginBody.parse({ username: 'bad name', password: 'x' })).toThrow()
  })
  it('user: password min 8, role enum', () => {
    expect(() =>
      createUserBody.parse({
        username: 'ivan',
        password: 'short',
        name: 'Иван',
        role: 'technician',
      }),
    ).toThrow()
    expect(() =>
      createUserBody.parse({
        username: 'ivan',
        password: 'longenough',
        name: 'Иван',
        role: 'boss',
      }),
    ).toThrow()
    expect(
      createUserBody.parse({
        username: 'ivan',
        password: 'longenough',
        name: 'Иван',
        role: 'technician',
      }).role,
    ).toBe('technician')
  })
  it('tenant settings have defaults', () => {
    const s = tenantSettings.parse({})
    expect(s.checkIntervalDays).toBe(30)
    expect(s.cycleStrategy).toBe('rolling')
    expect(s.currencyDisplay).toBe('EUR')
  })
  it('register tenant requires owner credentials', () => {
    expect(() =>
      registerTenantBody.parse({
        name: 'Фирма',
        eik: '123456789',
        address: 'x',
        phone: '02 1',
        emergencyPhone: '0700',
        owner: { username: 'a', password: 'b', name: 'c' },
      }),
    ).toThrow()
    const ok = registerTenantBody.parse({
      name: 'Фирма',
      eik: '123456789',
      address: 'София',
      phone: '02 111 2222',
      emergencyPhone: '0700 11 111',
      owner: { username: 'owner', password: 'password1', name: 'Собственик' },
    })
    expect(ok.locale).toBe('bg')
  })
})

describe('payments are non-cash only (Наредба Н-18 / СУПТО)', () => {
  const cashIssue = (
    body: {
      safeParse: (v: unknown) => {
        success: boolean
        error?: { issues: Array<{ message: string }> }
      }
    },
    value: unknown,
  ) => {
    const r = body.safeParse(value)
    expect(r.success).toBe(false)
    expect(r.error!.issues.map((i) => i.message)).toContain('billing.cashNotAllowed')
  }
  it('pay / create payment / bulk refuse cash with billing.cashNotAllowed', () => {
    cashIssue(payInvoiceBody, { paidAt: '2026-09-15', method: 'cash' })
    cashIssue(createPaymentBody, {
      buildingId: uuid,
      amountCents: 1000,
      paidAt: '2026-09-15',
      method: 'cash',
    })
    cashIssue(bulkInvoiceBody, { action: 'pay', ids: [uuid], method: 'cash' })
  })
  it('bank is the default and other is accepted', () => {
    expect(payInvoiceBody.parse({ paidAt: '2026-09-15' }).method).toBe('bank')
    expect(payInvoiceBody.parse({ paidAt: '2026-09-15', method: 'other' }).method).toBe('other')
    expect(
      createPaymentBody.parse({ buildingId: uuid, amountCents: 1000, paidAt: '2026-09-15' }).method,
    ).toBe('bank')
  })
  it('the read enum still parses legacy cash rows', () => {
    expect(PaymentMethod.parse('cash')).toBe('cash')
  })
})
