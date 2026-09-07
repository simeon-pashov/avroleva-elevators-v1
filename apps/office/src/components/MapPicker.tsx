import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useI18n } from '../i18n/I18nProvider'

const TILES =
  (import.meta.env.VITE_MAP_TILES_URL as string | undefined) ||
  'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const SOFIA: [number, number] = [42.6977, 23.3219]

// Leaflet's default icon paths break under bundlers; draw a simple divIcon instead.
const pinIcon = L.divIcon({ className: 'map-pin', iconSize: [18, 18], iconAnchor: [9, 9] })

export interface MapPickerProps {
  lat: number | null
  lng: number | null
  /** When set, the pin is draggable and clicking the map places it. */
  onChange?: (lat: number, lng: number) => void
  height?: number
}

/** Small Leaflet map to place/drag one pin (building location). */
export function MapPicker({ lat, lng, onChange, height = 320 }: MapPickerProps) {
  const { t } = useI18n()
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const marker = useRef<L.Marker | null>(null)
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  })

  useEffect(() => {
    if (!el.current || map.current) return
    const m = L.map(el.current, {
      center: lat != null && lng != null ? [lat, lng] : SOFIA,
      zoom: lat != null ? 16 : 11,
    })
    L.tileLayer(TILES, { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(m)
    m.on('click', (e: L.LeafletMouseEvent) => {
      if (onChangeRef.current) onChangeRef.current(round(e.latlng.lat), round(e.latlng.lng))
    })
    map.current = m
    return () => {
      m.remove()
      map.current = null
      marker.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const m = map.current
    if (!m) return
    if (lat == null || lng == null) {
      marker.current?.remove()
      marker.current = null
      return
    }
    if (!marker.current) {
      const mk = L.marker([lat, lng], { icon: pinIcon, draggable: !!onChange }).addTo(m)
      mk.on('dragend', () => {
        const p = mk.getLatLng()
        onChangeRef.current?.(round(p.lat), round(p.lng))
      })
      marker.current = mk
      m.setView([lat, lng], Math.max(m.getZoom(), 16))
    } else {
      marker.current.setLatLng([lat, lng])
      if (!m.getBounds().contains([lat, lng])) m.panTo([lat, lng])
    }
  }, [lat, lng, onChange])

  return (
    <div className="map-wrap">
      <div ref={el} style={{ height }} className="map" />
      {onChange ? <div className="map-hint muted">{t('buildings.mapHint')}</div> : null}
    </div>
  )
}

function round(n: number) {
  return Math.round(n * 1e6) / 1e6
}
