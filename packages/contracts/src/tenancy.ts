import { z } from 'zod'
import { TenantStatus, UserRole } from './enums.js'
import { nullableText, optionalText, phone } from './common.js'

export const username = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(40)
  .regex(/^[a-z0-9._-]+$/, { message: 'validation.username' })

export const password = z.string().min(8).max(200)

export const locale = z.string().trim().min(2).max(5)

export const loginBody = z.object({ username, password: z.string().min(1).max(200) })
export type LoginBody = z.infer<typeof loginBody>

export const tenantSettings = z.object({
  checkIntervalDays: z.number().int().min(1).max(365).default(30),
  cycleStrategy: z.enum(['rolling', 'calendar_month']).default('rolling'),
  callbackSlaMinutes: z
    .number()
    .int()
    .min(5)
    .max(24 * 60)
    .default(60),
  defectFollowUpDays: z.number().int().min(1).max(365).default(30),
  showBgnReference: z.boolean().default(false),
  currencyDisplay: z.enum(['EUR', 'EUR_BGN']).default('EUR'),
})
export type TenantSettings = z.infer<typeof tenantSettings>

export const updateTenantBody = z.object({
  name: z.string().trim().min(2).max(200).optional(),
  eik: optionalText(20),
  vatNo: nullableText(20),
  address: optionalText(500),
  phone: phone.optional(),
  emergencyPhone: phone.optional(),
  email: z.email().optional().or(z.literal('')),
  locale: locale.optional(),
  settings: tenantSettings.partial().optional(),
})
export type UpdateTenantBody = z.infer<typeof updateTenantBody>

export interface TenantDto {
  id: string
  name: string
  eik: string
  vatNo: string | null
  address: string
  phone: string
  emergencyPhone: string
  email: string | null
  locale: string
  timezone: string
  status: z.infer<typeof TenantStatus>
  settings: TenantSettings
  createdAt: string
}

export const createUserBody = z.object({
  username,
  password,
  name: z.string().trim().min(2).max(120),
  role: UserRole,
  email: z.email().optional().or(z.literal('')),
  phone: phone.optional().or(z.literal('')),
  locale: locale.optional(),
})
export type CreateUserBody = z.infer<typeof createUserBody>

export const updateUserBody = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  role: UserRole.optional(),
  email: z.email().nullable().optional().or(z.literal('')),
  phone: phone.nullable().optional().or(z.literal('')),
  locale: locale.nullable().optional(),
  isActive: z.boolean().optional(),
})
export type UpdateUserBody = z.infer<typeof updateUserBody>

export const setPasswordBody = z.object({ password })
export type SetPasswordBody = z.infer<typeof setPasswordBody>

export const updateMeBody = z.object({
  locale: locale.optional(),
  name: z.string().trim().min(2).max(120).optional(),
})
export type UpdateMeBody = z.infer<typeof updateMeBody>

export interface UserDto {
  id: string
  tenantId: string
  username: string
  name: string
  role: z.infer<typeof UserRole>
  email: string | null
  phone: string | null
  locale: string | null
  isActive: boolean
  lastLoginAt: string | null
  createdAt: string
}

export interface MeDto {
  user: UserDto
  tenant: TenantDto
  /** Effective locale: user.locale -> tenant.locale -> 'bg'. */
  locale: string
}

export interface LoginResponse extends MeDto {
  /** Same token that is set as the httpOnly cookie, for Bearer clients. */
  token: string
}

// ---- Platform admin -------------------------------------------------------------------------

export const adminLoginBody = loginBody

export const registerTenantBody = z.object({
  name: z.string().trim().min(2).max(200),
  eik: z.string().trim().min(9).max(13),
  address: z.string().trim().min(3).max(500),
  phone,
  emergencyPhone: phone,
  email: z.email().optional().or(z.literal('')),
  locale: locale.default('bg'),
  owner: z.object({
    username,
    password,
    name: z.string().trim().min(2).max(120),
    email: z.email().optional().or(z.literal('')),
  }),
})
export type RegisterTenantBody = z.infer<typeof registerTenantBody>

export const adminUpdateTenantBody = z.object({
  status: TenantStatus.optional(),
  name: z.string().trim().min(2).max(200).optional(),
})
export type AdminUpdateTenantBody = z.infer<typeof adminUpdateTenantBody>

export interface AdminTenantDto extends TenantDto {
  counts: {
    users: number
    buildings: number
    elevators: number
    customers: number
    contracts: number
  }
}

export interface AdminMeDto {
  admin: { id: string; username: string }
}
