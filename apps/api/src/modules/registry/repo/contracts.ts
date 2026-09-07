import { prisma } from '../../../platform/db/prisma.js'
import type { Tx } from '../../../platform/db/prisma.js'
import { newId } from '../../../platform/ids.js'
import { pageArgs } from '../../../platform/http/pagination.js'
import type { ContractStatus, Prisma } from '../../../generated/prisma/index.js'

const withRelations = {
  lines: {
    include: { elevator: { select: { internalNo: true } } },
    orderBy: { id: 'asc' as const },
  },
  customer: { select: { name: true } },
  building: { select: { addressText: true } },
} as const

export function listContracts(
  tenantId: string,
  q: {
    cursor?: string
    limit: number
    q?: string
    customerId?: string
    buildingId?: string
    status?: ContractStatus
  },
) {
  const where: Prisma.ContractWhereInput = {
    tenantId,
    deletedAt: null,
    ...(q.customerId ? { customerId: q.customerId } : {}),
    ...(q.buildingId ? { buildingId: q.buildingId } : {}),
    ...(q.status ? { status: q.status } : {}),
    ...(q.q
      ? {
          OR: [
            { customer: { name: { contains: q.q, mode: 'insensitive' } } },
            { building: { addressText: { contains: q.q, mode: 'insensitive' } } },
          ],
        }
      : {}),
  }
  return prisma.contract.findMany({ ...pageArgs(q), where, include: withRelations })
}

export function contractsForBuilding(tenantId: string, buildingId: string) {
  return prisma.contract.findMany({
    where: { tenantId, buildingId, deletedAt: null },
    include: withRelations,
    orderBy: { startDate: 'desc' },
  })
}

export function findContract(tenantId: string, id: string, tx?: Tx) {
  const db = tx ?? prisma
  return db.contract.findFirst({ where: { id, tenantId, deletedAt: null }, include: withRelations })
}

export function findActiveContractForBuilding(tenantId: string, buildingId: string, tx?: Tx) {
  const db = tx ?? prisma
  return db.contract.findFirst({
    where: { tenantId, buildingId, deletedAt: null, status: 'active' },
    include: withRelations,
  })
}

export interface ContractLineInput {
  elevatorId: string
  monthlyPriceCents: number
  fromDate?: Date | null
}

export interface ContractData {
  customerId: string
  buildingId: string
  startDate: Date
  endDate?: Date | null
  status: ContractStatus
  paymentDay?: number | null
  notes?: string | null
  createdBy?: string | null
}

export function createContract(
  tenantId: string,
  data: ContractData,
  lines: ContractLineInput[],
  tx?: Tx,
) {
  const db = tx ?? prisma
  return db.contract.create({
    data: {
      id: newId(),
      tenantId,
      ...data,
      lines: {
        create: lines.map((l) => ({
          id: newId(),
          tenantId,
          elevatorId: l.elevatorId,
          monthlyPriceCents: l.monthlyPriceCents,
          fromDate: l.fromDate ?? data.startDate,
        })),
      },
    },
    include: withRelations,
  })
}

export function updateContract(
  tenantId: string,
  id: string,
  data: Prisma.ContractUncheckedUpdateInput,
  tx?: Tx,
) {
  const db = tx ?? prisma
  return db.contract.update({ where: { id, tenantId }, data, include: withRelations })
}

/** Replaces the price lines (history-preserving version comes with billing in step 2). */
export async function replaceLines(
  tenantId: string,
  contractId: string,
  lines: ContractLineInput[],
  fromDate: Date,
  tx: Tx,
) {
  await tx.contractElevator.deleteMany({ where: { tenantId, contractId } })
  await tx.contractElevator.createMany({
    data: lines.map((l) => ({
      id: newId(),
      tenantId,
      contractId,
      elevatorId: l.elevatorId,
      monthlyPriceCents: l.monthlyPriceCents,
      fromDate: l.fromDate ?? fromDate,
    })),
  })
}

export function addLines(
  tenantId: string,
  contractId: string,
  lines: ContractLineInput[],
  fromDate: Date,
  tx: Tx,
) {
  return tx.contractElevator.createMany({
    data: lines.map((l) => ({
      id: newId(),
      tenantId,
      contractId,
      elevatorId: l.elevatorId,
      monthlyPriceCents: l.monthlyPriceCents,
      fromDate: l.fromDate ?? fromDate,
    })),
  })
}

export function closeLines(tenantId: string, contractId: string, toDate: Date, tx: Tx) {
  return tx.contractElevator.updateMany({
    where: { tenantId, contractId, toDate: null },
    data: { toDate },
  })
}

export function countContracts(tenantId: string) {
  return prisma.contract.count({ where: { tenantId, deletedAt: null, status: 'active' } })
}
