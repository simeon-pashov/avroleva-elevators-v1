import { describe, expect, it } from 'vitest'
import { TenantScopeError, assertTenantScoped } from '../../src/platform/db/prisma.js'

describe('tenant guard (Prisma extension)', () => {
  it('throws for reads/writes on tenant-owned models without tenantId', () => {
    expect(() =>
      assertTenantScoped('Elevator', 'findMany', { where: { status: 'active' } }),
    ).toThrow(TenantScopeError)
    expect(() =>
      assertTenantScoped('Building', 'update', { where: { id: 'x' }, data: {} }),
    ).toThrow(TenantScopeError)
    expect(() => assertTenantScoped('Customer', 'create', { data: { name: 'x' } })).toThrow(
      TenantScopeError,
    )
    expect(() => assertTenantScoped('User', 'findMany', {})).toThrow(TenantScopeError)
  })
  it('passes when tenantId is present (directly or inside AND)', () => {
    expect(() =>
      assertTenantScoped('Elevator', 'findMany', { where: { tenantId: 't1' } }),
    ).not.toThrow()
    expect(() =>
      assertTenantScoped('Elevator', 'count', {
        where: { AND: [{ tenantId: 't1' }, { status: 'active' }] },
      }),
    ).not.toThrow()
    expect(() =>
      assertTenantScoped('Customer', 'create', { data: { tenantId: 't1', name: 'x' } }),
    ).not.toThrow()
    expect(() =>
      assertTenantScoped('ContractElevator', 'createMany', {
        data: [{ tenantId: 't1' }, { tenantId: 't1' }],
      }),
    ).not.toThrow()
  })
  it('ignores non-tenant models', () => {
    expect(() => assertTenantScoped('Tenant', 'findMany', {})).not.toThrow()
    expect(() =>
      assertTenantScoped('Session', 'findUnique', { where: { tokenHash: 'h' } }),
    ).not.toThrow()
  })
})
