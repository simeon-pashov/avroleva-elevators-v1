import { useState } from 'react'
import type { ExportDataset } from '@avroleva/contracts'
import { downloadCsv } from '../lib/download'
import { useAuth } from '../auth/AuthProvider'
import { useI18n } from '../i18n/I18nProvider'
import { toast } from './ui'

/**
 * "Експорт CSV" for one dataset (owner/office only). Fetches with the CSRF header and saves the
 * file - a bare link to /api would be rejected (see lib/download.ts).
 */
export function ExportCsvButton({
  dataset,
  label,
  className,
}: {
  dataset: ExportDataset
  label?: string
  className?: string
}) {
  const { t } = useI18n()
  const { hasRole } = useAuth()
  const [busy, setBusy] = useState(false)
  if (!hasRole('owner', 'office')) return null
  return (
    <button
      type="button"
      className={className ?? 'btn btn-small'}
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        try {
          await downloadCsv(dataset)
        } catch (e) {
          toast(e instanceof Error ? e.message : t('error.internal'), 'error')
        } finally {
          setBusy(false)
        }
      }}
    >
      {label ?? t('common.exportCsv')}
    </button>
  )
}
