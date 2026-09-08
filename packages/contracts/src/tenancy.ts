import { z } from 'zod'
import { TenantStatus, UserRole } from './enums.js'
import { nullableText, optionalText, patchOf, phone } from './common.js'

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
  /** Invoice due date = issue date + N days, unless the contract has a paymentDay. */
  invoiceDueDays: z.number().int().min(0).max(120).default(14),
  /** Applied to generated invoices; 0 = not VAT-registered (чл. 113 ал. 9). */
  vatRatePercent: z.number().int().min(0).max(27).default(20),
  showBgnReference: z.boolean().default(false),
  currencyDisplay: z.enum(['EUR', 'EUR_BGN']).default('EUR'),
  /** Overrides of packages/domain-data/calendar-rules.json; null/absent = the shipped default. */
  inspectionIntervalMonths: z.number().int().min(1).max(120).nullable().optional(),
  firstInspectionIntervalMonths: z.number().int().min(1).max(120).nullable().optional(),
  inspectionAlertDays: z.array(z.number().int().min(1).max(365)).max(8).nullable().optional(),
  /** Alarm-device (voice link) test cadence; null = not tracked. */
  alarmTestIntervalMonths: z.number().int().min(1).max(60).nullable().optional(),
  /** Fewer technicians on a visit than this flags it `singleTechnician` (the office sees a badge). */
  minTechnicians: z
    .object({
      functional_check: z.number().int().min(1).max(4).default(2),
      technical_maintenance: z.number().int().min(1).max(4).default(2),
      repair: z.number().int().min(1).max(4).default(2),
      callback: z.number().int().min(1).max(4).default(1),
      other: z.number().int().min(1).max(4).default(1),
    })
    .default({
      functional_check: 2,
      technical_maintenance: 2,
      repair: 2,
      callback: 1,
      other: 1,
    }),
})
export type TenantSettings = z.infer<typeof tenantSettings>

/** Feature flags per tenant (ARCHITECTURE A7). Default off unless the seed / owner turns them on. */
export const tenantFeatures = z.object({
  /** The QR page `/p/:token` answers at all. */
  publicQrPage: z.boolean().default(false),
  /** The public page shows the fault-report form. */
  publicFaultReport: z.boolean().default(false),
  /** Technician app records a GPS point at submit (off by default: technicians read it as surveillance). */
  gpsCapture: z.boolean().default(false),
})
export type TenantFeatures = z.infer<typeof tenantFeatures>
export const FEATURE_KEYS = Object.keys(tenantFeatures.shape) as Array<keyof TenantFeatures>

export const updateTenantBody = z.object({
  name: z.string().trim().min(2).max(200).optional(),
  eik: optionalText(20),
  vatNo: nullableText(20),
  address: optionalText(500),
  phone: phone.optional(),
  emergencyPhone: phone.optional(),
  email: z.email().optional().or(z.literal('')),
  locale: locale.optional(),
  settings: patchOf(tenantSettings).optional(),
  features: patchOf(tenantFeatures).optional(),
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
  features: TenantFeatures
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

// ---- Device enrollment & sessions (technician app) ------------------------------------------

/** POST /users/:id/enroll-token (owner/office): one-time, 10 minutes, shown as a QR. */
export interface EnrollmentTokenDto {
  userId: string
  userName: string
  token: string
  expiresAt: string
  /** URL the phone opens (the tech app with `?enroll=<token>`), also the QR payload. */
  url: string
  /** Inline SVG of the QR (server-rendered, safe to inject). */
  qrSvg: string
}

export const enrollBody = z.object({
  token: z.string().trim().min(16).max(120),
  deviceName: z.string().trim().min(1).max(80),
  clientVersion: z.string().trim().max(40).optional(),
})
export type EnrollBody = z.infer<typeof enrollBody>

export interface EnrollResponse extends MeDto {
  /** Device session token (Bearer), 180 days sliding. */
  token: string
  sessionId: string
  expiresAt: string
}

export interface SessionDto {
  id: string
  userId: string
  userName: string
  kind: 'browser' | 'device'
  deviceName: string | null
  clientVersion: string | null
  createdAt: string
  lastSeenAt: string
  expiresAt: string
  /** The session making the request. */
  current: boolean
}

export const ENROLLMENT_TOKEN_TTL_MS = 10 * 60 * 1000

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
