import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { DashboardDto, DashboardPinDto, DueState, GeoSuggestionDto } from '@avroleva/contracts'
import { useI18n } from '../../i18n/I18nProvider'
import type { I18n } from '../../i18n/I18nProvider'
import { elevatorStatusBadge } from '../elevators/ElevatorsListPage'
import { AddressSearch } from '../../components/AddressSearch'

const TILES =
  (import.meta.env.VITE_MAP_TILES_URL as string | undefined) ||
  'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const SOFIA: L.LatLngTuple = [42.6977, 23.3219]
const STORAGE_KEY = 'avroleva.dashboard.map'
/** Pins sharing a building's coordinates are spread on a circle of this radius (screen px). */
const SPREAD_PX = 14
export const DUE_STATES: readonly DueState[] = ['overdue', 'today', 'soon', 'ok', 'stopped', 'none']

interface Viewport {
  lat: number
  lng: number
  zoom: number
}

function readViewport(): Viewport | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as Partial<Viewport>
    if (typeof v.lat === 'number' && typeof v.lng === 'number' && typeof v.zoom === 'number')
      return { lat: v.lat, lng: v.lng, zoom: v.zoom }
    return null
  } catch {
    return null
  }
}

function saveViewport(m: L.Map) {
  try {
    const c = m.getCenter()
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ lat: c.lat, lng: c.lng, zoom: m.getZoom() }))
  } catch {
    /* private mode */
  }
}

function pinIcon(p: DashboardPinDto) {
  const extra = p.openCallbacks > 0 ? ' pin-alert' : p.stopLift ? ' pin-stoplift' : ''
  return L.divIcon({
    className: `pin pin-${p.state}${extra}`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    popupAnchor: [0, -8],
  })
}

interface Placed {
  marker: L.Marker
  center: L.LatLng
  index: number
  size: number
}

/** Position every marker; members of a shared point go on a small circle around it. */
function spread(m: L.Map, items: Placed[]) {
  for (const it of items) {
    if (it.size === 1) {
      it.marker.setLatLng(it.center)
      continue
    }
    const p = m.latLngToLayerPoint(it.center)
    const angle = (2 * Math.PI * it.index) / it.size - Math.PI / 2
    const q = L.point(p.x + SPREAD_PX * Math.cos(angle), p.y + SPREAD_PX * Math.sin(angle))
    it.marker.setLatLng(m.layerPointToLatLng(q))
  }
}

function fitAll(m: L.Map, pins: DashboardPinDto[]) {
  if (pins.length === 0) return
  m.fitBounds(L.latLngBounds(pins.map((p) => [p.lat, p.lng] as L.LatLngTuple)), {
    padding: [32, 32],
    maxZoom: 16,
  })
}

function dueStateBadge(state: DueState): string {
  switch (state) {
    case 'overdue':
      return 'danger'
    case 'today':
      return 'warn'
    case 'soon':
      return 'info'
    case 'ok':
      return 'ok'
    default:
      return 'muted'
  }
}

/** Popup DOM (Leaflet owns it, so no React here); all text goes through t(). */
function popupContent(p: DashboardPinDto, i18n: I18n, open: () => void): HTMLElement {
  const { t, date } = i18n
  const root = document.createElement('div')
  root.className = 'pin-popup'
  const title = document.createElement('div')
  title.className = 'pin-popup-title'
  title.textContent = p.internalNo
  const addr = document.createElement('div')
  addr.className = 'small'
  addr.textContent = p.addressText
  const badges = document.createElement('div')
  badges.className = 'pin-popup-badges'
  const status = document.createElement('span')
  status.className = `badge badge-${elevatorStatusBadge(p.status)}`
  status.textContent = t(`enum.elevatorStatus.${p.status}`)
  const state = document.createElement('span')
  state.className = `badge badge-${dueStateBadge(p.state)}`
  state.textContent = t(`enum.dueState.${p.state}`)
  badges.append(status, state)
  if (p.stopLift) {
    const stop = document.createElement('span')
    stop.className = 'badge badge-danger'
    stop.textContent = t('defects.stopped')
    badges.append(stop)
  }
  if (p.openCallbacks > 0) {
    const cb = document.createElement('span')
    cb.className = 'badge badge-danger'
    cb.textContent = t('elevators.openCallbacks', { count: p.openCallbacks })
    badges.append(cb)
  }
  const due = document.createElement('div')
  due.className = 'small'
  due.textContent = `${t('elevators.nextCheckDue')}: ${
    p.nextCheckDueAt ? date(p.nextCheckDueAt) : t('elevators.neverChecked')
  }`
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'btn btn-small btn-primary'
  btn.textContent = t('dashboard.open')
  btn.addEventListener('click', open)
  root.append(title, addr, badges, due, btn)
  return root
}

/** The temporary pin dropped by the address search (draggable until the building is saved). */
const droppedIcon = L.divIcon({
  className: 'map-pin map-pin-dropped',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
})

export function DashboardMap({
  pins,
  counts,
  onOpen,
  search,
  dropped,
  onDrop,
  onAddHere,
  focus,
}: {
  pins: DashboardPinDto[]
  counts: DashboardDto['counts'] | null
  onOpen: (elevatorId: string) => void
  /** Show the address search (owner / office). */
  search?: boolean
  /** The dropped pin, if any (controlled by the page). */
  dropped?: { lat: number; lng: number } | null
  /** A suggestion was picked (s given) or the pin was dragged (s undefined). */
  onDrop?: (p: { lat: number; lng: number } | null, s?: GeoSuggestionDto | null) => void
  onAddHere?: () => void
  /** Fly here (after a save). */
  focus?: { lat: number; lng: number; zoom?: number } | null
}) {
  const i18n = useI18n()
  const { t } = i18n
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)
  const placed = useRef<Placed[]>([])
  const fitted = useRef(false)
  const onOpenRef = useRef(onOpen)
  const onDropRef = useRef(onDrop)
  const i18nRef = useRef(i18n)
  const droppedMarker = useRef<L.Marker | null>(null)
  const [centre, setCentre] = useState<{ lat: number; lng: number } | null>(null)
  useEffect(() => {
    onOpenRef.current = onOpen
    onDropRef.current = onDrop
    i18nRef.current = i18n
  })

  // The dropped pin: created once, moved on every change, draggable (drag = correct the point).
  useEffect(() => {
    const m = map.current
    if (!m) return
    if (!dropped) {
      droppedMarker.current?.remove()
      droppedMarker.current = null
      return
    }
    if (!droppedMarker.current) {
      const mk = L.marker([dropped.lat, dropped.lng], {
        icon: droppedIcon,
        draggable: true,
        zIndexOffset: 1000,
      }).addTo(m)
      mk.on('dragend', () => {
        const p = mk.getLatLng()
        onDropRef.current?.({
          lat: Math.round(p.lat * 1e6) / 1e6,
          lng: Math.round(p.lng * 1e6) / 1e6,
        })
      })
      droppedMarker.current = mk
    } else {
      droppedMarker.current.setLatLng([dropped.lat, dropped.lng])
    }
  }, [dropped])

  useEffect(() => {
    const m = map.current
    if (!m || !focus) return
    m.flyTo([focus.lat, focus.lng], focus.zoom ?? Math.max(m.getZoom(), 17), { duration: 0.6 })
  }, [focus])

  // Create the map once; restore the last viewport when there is one.
  useEffect(() => {
    if (!el.current || map.current) return
    const stored = readViewport()
    const m = L.map(el.current, {
      center: stored ? [stored.lat, stored.lng] : SOFIA,
      zoom: stored?.zoom ?? 12,
    })
    L.tileLayer(TILES, { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(m)
    layer.current = L.layerGroup().addTo(m)
    if (stored) fitted.current = true
    m.on('moveend', () => {
      saveViewport(m)
      const c = m.getCenter()
      setCentre({ lat: c.lat, lng: c.lng })
    })
    m.on('zoomend', () => spread(m, placed.current))
    map.current = m
    return () => {
      m.remove()
      map.current = null
      layer.current = null
      placed.current = []
    }
  }, [])

  // (Re)draw the pins whenever they change (colour = due state).
  useEffect(() => {
    const m = map.current
    const lg = layer.current
    if (!m || !lg) return
    lg.clearLayers()
    const byPoint = new Map<string, DashboardPinDto[]>()
    for (const p of pins) {
      const key = `${p.lat},${p.lng}`
      const group = byPoint.get(key)
      if (group) group.push(p)
      else byPoint.set(key, [p])
    }
    const items: Placed[] = []
    for (const group of byPoint.values()) {
      group.forEach((p, index) => {
        const center = L.latLng(p.lat, p.lng)
        const marker = L.marker(center, { icon: pinIcon(p), title: p.label })
        marker.bindPopup(
          () => popupContent(p, i18nRef.current, () => onOpenRef.current(p.elevatorId)),
          { minWidth: 200 },
        )
        marker.on('click', () => onOpenRef.current(p.elevatorId))
        marker.addTo(lg)
        items.push({ marker, center, index, size: group.length })
      })
    }
    placed.current = items
    spread(m, items)
    if (!fitted.current && pins.length > 0) {
      fitAll(m, pins)
      fitted.current = true
    }
  }, [pins])

  return (
    <div className="dash-map">
      {search ? (
        <div className="map-search">
          <AddressSearch
            bias={centre}
            compact
            onPick={(s) => {
              const m = map.current
              if (m) m.flyTo([s.lat, s.lng], 17, { duration: 0.8 })
              onDropRef.current?.({ lat: s.lat, lng: s.lng }, s)
            }}
          />
          {dropped ? (
            <div className="map-search-actions">
              <button type="button" className="btn btn-small btn-primary" onClick={onAddHere}>
                {t('geo.addHere')}
              </button>
              <button
                type="button"
                className="btn btn-small"
                onClick={() => onDropRef.current?.(null, null)}
              >
                {t('common.cancel')}
              </button>
              <span className="small muted">{t('geo.dragHint')}</span>
            </div>
          ) : null}
        </div>
      ) : null}
      <div ref={el} className="map map-dashboard" />
      <div className="map-legend">
        {DUE_STATES.map((s) => (
          <span key={s} className="legend-item">
            <i className={`pin pin-${s} legend-dot`} />
            <span>{t(`enum.dueState.${s}`)}</span>
            {counts ? <b>{counts[s]}</b> : null}
          </span>
        ))}
        <span className="legend-spacer" />
        {counts && counts.buildingsWithoutCoordinates > 0 ? (
          <span className="muted small">
            {t('dashboard.withoutCoordinates', { count: counts.buildingsWithoutCoordinates })}
          </span>
        ) : null}
        {counts && pins.length === 0 ? (
          <span className="muted small">{t('dashboard.noPins')}</span>
        ) : null}
        <button
          type="button"
          className="btn btn-small"
          disabled={pins.length === 0}
          onClick={() => map.current && fitAll(map.current, pins)}
        >
          {t('dashboard.showAll')}
        </button>
      </div>
    </div>
  )
}
