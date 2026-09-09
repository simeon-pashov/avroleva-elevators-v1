import type { TenantBankDetailsDto, TenantSettings } from '@avroleva/contracts'
import { formatIban } from '@avroleva/contracts'
import type { EpcQrDto } from '@avroleva/contracts'
import { epcPayload, epcQrSvg } from './epc.js'

/** The tenant's bank block for documents, or null until an IBAN is configured. */
export function bankDetailsOf(
  settings: TenantSettings,
  tenantName: string,
): TenantBankDetailsDto | null {
  const b = settings.billing.bank
  if (!b.iban) return null
  return {
    beneficiary: b.beneficiary || tenantName,
    iban: b.iban,
    ibanFormatted: formatIban(b.iban),
    bic: b.bic,
    bankName: b.bankName,
  }
}

/** EPC QR for an amount + reference, or null when there is nothing to pay or no bank details. */
export async function epcFor(
  bank: TenantBankDetailsDto | null,
  amountCents: number,
  reference: string,
  information?: string | null,
): Promise<EpcQrDto | null> {
  if (!bank || amountCents <= 0) return null
  const payload = epcPayload({
    beneficiary: bank.beneficiary,
    iban: bank.iban,
    bic: bank.bic || null,
    amountCents,
    remittance: reference,
    information: information ?? null,
  })
  return { payload, svg: await epcQrSvg(payload), amountCents, reference }
}
