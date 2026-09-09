import { useState } from 'react'
import type { BuildingDto, GeoSuggestionDto } from '@avroleva/contracts'
import { put } from '../lib/api'
import { useI18n } from '../i18n/I18nProvider'
import { ErrorBox, toast } from './ui'
import { AddressSearch } from './AddressSearch'
import { MapPicker } from './MapPicker'

/**
 * "Постави на картата" for a building without coordinates (import rows, failed geocodes): the
 * same search-and-drop flow - search, the pin lands on the suggestion, drag to fix, save.
 */
export function PlaceOnMapDialog({
  building,
  onClose,
  onSaved,
}: {
  building: BuildingDto
  onClose: () => void
  onSaved: (b: BuildingDto) => void
}) {
  const { t } = useI18n()
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(
    building.lat != null && building.lng != null ? { lat: building.lat, lng: building.lng } : null,
  )
  const [picked, setPicked] = useState<GeoSuggestionDto | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)

  const save = async () => {
    if (!point) return
    setBusy(true)
    setError(null)
    try {
      const b = await put<BuildingDto>(`/buildings/${building.id}/location`, point)
      toast(t('common.saved'))
      onSaved(b)
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="drawer-root">
      <div className="drawer-backdrop" onClick={onClose} />
      <aside
        className="drawer drawer-wide"
        role="dialog"
        aria-modal="true"
        aria-label={t('geo.placeOnMap')}
      >
        <div className="drawer-head">
          <h2>{t('geo.placeOnMap')}</h2>
          <button type="button" className="btn btn-small drawer-close" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
        <p className="small">{building.addressText}</p>
        <AddressSearch
          autoFocus
          bias={point}
          onPick={(s) => {
            setPicked(s)
            setPoint({ lat: s.lat, lng: s.lng })
          }}
        />
        {picked?.approximate ? <p className="muted small">{t('geo.blockCentreHint')}</p> : null}
        <MapPicker
          lat={point?.lat ?? null}
          lng={point?.lng ?? null}
          height={340}
          onChange={(lat, lng) => setPoint({ lat, lng })}
        />
        <ErrorBox error={error} />
        <div className="actions drawer-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!point || busy}
            onClick={save}
          >
            {t('common.save')}
          </button>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </button>
        </div>
      </aside>
    </div>
  )
}
