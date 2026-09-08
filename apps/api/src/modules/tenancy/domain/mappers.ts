import { tenantFeatures, tenantSettings } from '@avroleva/contracts'
import type { TenantDto, TenantFeatures, TenantSettings, UserDto } from '@avroleva/contracts'
import type { Tenant, User } from '../../../generated/prisma/index.js'

export function parseSettings(raw: unknown): TenantSettings {
  const parsed = tenantSettings.safeParse(raw ?? {})
  return parsed.success ? parsed.data : tenantSettings.parse({})
}

export function parseFeatures(raw: unknown): TenantFeatures {
  const parsed = tenantFeatures.safeParse(raw ?? {})
  return parsed.success ? parsed.data : tenantFeatures.parse({})
}

export function toTenantDto(t: Tenant): TenantDto {
  return {
    id: t.id,
    name: t.name,
    eik: t.eik,
    vatNo: t.vatNo,
    address: t.address,
    phone: t.phone,
    emergencyPhone: t.emergencyPhone,
    email: t.email,
    locale: t.locale,
    timezone: t.timezone,
    status: t.status,
    settings: parseSettings(t.settings),
    features: parseFeatures(t.features),
    createdAt: t.createdAt.toISOString(),
    deletionAt: t.deletionAt ? t.deletionAt.toISOString() : null,
  }
}

export function toUserDto(u: User): UserDto {
  return {
    id: u.id,
    tenantId: u.tenantId,
    username: u.username,
    name: u.name,
    role: u.role,
    email: u.email,
    phone: u.phone,
    locale: u.locale,
    isActive: u.isActive,
    lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
    createdAt: u.createdAt.toISOString(),
  }
}
