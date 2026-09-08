import { z } from 'zod'

// Values are the Postgres enum values (apps/api/prisma/schema.prisma) - keep them in sync.
export const UserRole = z.enum(['owner', 'office', 'technician'])
export type UserRole = z.infer<typeof UserRole>

export const TenantStatus = z.enum(['active', 'read_only', 'closed', 'deletion_scheduled'])
export type TenantStatus = z.infer<typeof TenantStatus>

export const CustomerKind = z.enum([
  'etazhna_sobstvenost',
  'professional_manager',
  'company',
  'institution',
])
export type CustomerKind = z.infer<typeof CustomerKind>

export const ContactRole = z.enum(['house_manager', 'cashier', 'manager', 'other'])
export type ContactRole = z.infer<typeof ContactRole>

export const GeocodeStatus = z.enum(['pending', 'ok', 'failed', 'manual'])
export type GeocodeStatus = z.infer<typeof GeocodeStatus>

export const DriveType = z.enum(['electric', 'hydraulic', 'mrl'])
export type DriveType = z.infer<typeof DriveType>

export const DoorType = z.enum(['manual', 'semi_auto', 'auto'])
export type DoorType = z.infer<typeof DoorType>

export const ElevatorStatus = z.enum([
  'active',
  'stopped_by_firm',
  'stopped_by_authority',
  'out_of_contract',
  'scrapped',
])
export type ElevatorStatus = z.infer<typeof ElevatorStatus>

export const ContractStatus = z.enum(['draft', 'active', 'terminated'])
export type ContractStatus = z.infer<typeof ContractStatus>

export const ImportStatus = z.enum(['preview', 'committed', 'rolled_back'])
export type ImportStatus = z.infer<typeof ImportStatus>
