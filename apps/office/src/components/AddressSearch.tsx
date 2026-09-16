import { useEffect, useRef, useState } from 'react'
import type { GeoSuggestionDto } from '@avroleva/contracts'
import { get, qs } from '../lib/api'
import { useI18n } from '../i18n/I18nProvider'
import { tameMapOverlay } from '../lib/mapOptions'

/**
 * As-you-type address search (step 8): 300 ms debounce, `GET /geo/search` (Nominatim behind
 * the Geocoder port, biased to the map centre), up to 8 suggestions. Choosing one hands the
 * point and the parsed address parts to the caller (the map flies there and drops a pin).
 */
export function AddressSearch({
  onPick,
  bias,
  placeholder,
  autoFocus,
  compact,
}: {
  onPick: (s: GeoSuggestionDto) => void
  /** Map centre for the bias box. */
  bias?: { lat: number; lng: number } | null
  placeholder?: string
  autoFocus?: boolean
  compact?: boolean
}) {
  const { t } = useI18n()
  const [q, setQ] = useState('')
  const [items, setItems] = useState<GeoSuggestionDto[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const biasRef = useRef(bias)
  // The label of the last picked suggestion: typing it back into the box is not a new search.
  const pickedRef = useRef<string | null>(null)
  useEffect(() => {
    biasRef.current = bias
  })

  useEffect(() => {
    const text = q.trim()
    if (text.length < 2 || text === pickedRef.current) {
      setItems([])
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    const h = setTimeout(() => {
      const b = biasRef.current
      get<{ items: GeoSuggestionDto[] }>(`/geo/search${qs({ q: text, lat: b?.lat, lng: b?.lng })}`)
        .then((r) => {
          if (cancelled) return
          setItems(r.items)
          setError(null)
          setOpen(true)
        })
        .catch(() => {
          if (cancelled) return
          setItems([])
          setError(t('geo.unavailable'))
        })
        .finally(() => !cancelled && setLoading(false))
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(h)
    }
  }, [q, t])

  return (
    <div className={`address-search${compact ? ' compact' : ''}`}>
      <input
        ref={tameMapOverlay}
        type="search"
        autoFocus={autoFocus}
        value={q}
        placeholder={placeholder ?? t('geo.searchPlaceholder')}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => items.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        aria-label={t('geo.search')}
      />
      {loading ? (
        <span ref={tameMapOverlay} className="address-search-loading muted small">
          …
        </span>
      ) : null}
      {error ? (
        <span ref={tameMapOverlay} className="field-error">
          {error}
        </span>
      ) : null}
      {open && items.length > 0 ? (
        <ul ref={tameMapOverlay} className="search-results">
          {items.map((s, i) => (
            <li key={`${s.lat},${s.lng},${i}`}>
              <button
                type="button"
                onMouseDown={(ev) => ev.preventDefault()}
                onClick={() => {
                  pickedRef.current = s.label
                  onPick(s)
                  setOpen(false)
                  setQ(s.label)
                }}
              >
                <strong>{s.label}</strong>
                {s.approximate ? (
                  <span className="small muted"> — {t('geo.approximate')}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : open && !loading && q.trim().length >= 2 && !error ? (
        <ul ref={tameMapOverlay} className="search-results">
          <li className="muted small search-results-empty">{t('geo.noResults')}</li>
        </ul>
      ) : null}
    </div>
  )
}
