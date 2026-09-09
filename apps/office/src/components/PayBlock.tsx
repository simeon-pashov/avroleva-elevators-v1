import { Link } from 'react-router'
import type { EpcQrDto, TenantBankDetailsDto } from '@avroleva/contracts'
import { formatIban } from '@avroleva/contracts'
import { useI18n } from '../i18n/I18nProvider'
import { useAuth } from '../auth/AuthProvider'
import { toast } from './ui'

/** Copies `text` to the clipboard and confirms with a toast (silently ignores a denied clipboard). */
export function CopyButton({ text, label }: { text: string; label?: string }) {
  const { t } = useI18n()
  return (
    <button
      type="button"
      className="btn btn-small copy-btn"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          toast(t('pay.copied'))
        } catch {
          toast(t('pay.copyFailed'), 'error')
        }
      }}
    >
      {label ?? t('billing.doc.copy')}
    </button>
  )
}

/**
 * "Плащане по банков път": the tenant's bank details, the payer reference and the EPC QR code the
 * API renders for the open amount. Shared by the invoice page and the building statement.
 */
export function PayBlock({
  bank,
  epc,
  reference,
  amountCents,
}: {
  bank: TenantBankDetailsDto | null
  epc: EpcQrDto | null
  /** Payment reference to print (invoice reference, or the statement's combined one). */
  reference?: string | null
  /** Open amount the block asks for; the EPC amount wins when present. */
  amountCents?: number | null
}) {
  const { t, moneyFull } = useI18n()
  const { hasRole } = useAuth()
  const dash = <span className="muted">—</span>
  const ref = epc?.reference ?? reference ?? null
  const amount = epc?.amountCents ?? amountCents ?? null

  return (
    <div className="card pay-block">
      <h2>{t('billing.doc.payBy')}</h2>
      {!bank ? (
        <p className="muted small">
          {t('pay.noBank')}{' '}
          {hasRole('owner') ? <Link to="/settings/billing">{t('pay.noBankLink')}</Link> : null}
        </p>
      ) : (
        <dl className="dl pay-dl">
          <dt>{t('billing.doc.beneficiary')}</dt>
          <dd>{bank.beneficiary || dash}</dd>
          <dt>{t('pay.iban')}</dt>
          <dd className="copy-row">
            <code>{bank.ibanFormatted || formatIban(bank.iban)}</code>
            {bank.iban ? <CopyButton text={bank.iban} /> : null}
          </dd>
          <dt>{t('pay.bic')}</dt>
          <dd>{bank.bic || dash}</dd>
          <dt>{t('pay.bankName')}</dt>
          <dd>{bank.bankName || dash}</dd>
          {ref ? (
            <>
              <dt>{t('billing.doc.reference')}</dt>
              <dd className="copy-row">
                <code>{ref}</code>
                <CopyButton text={ref} />
              </dd>
            </>
          ) : null}
          {amount != null ? (
            <>
              <dt>{t('billing.doc.open')}</dt>
              <dd>
                <strong>{moneyFull(amount)}</strong>
              </dd>
            </>
          ) : null}
        </dl>
      )}
      {epc ? (
        <div className="pay-qr-wrap">
          {/* Server-generated SVG (qrcode library) of the EPC069-12 payload; no user content inside. */}
          <div
            className="pay-qr"
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: epc.svg }}
          />
          <p className="muted small">{t('billing.doc.qrHint')}</p>
        </div>
      ) : null}
    </div>
  )
}
