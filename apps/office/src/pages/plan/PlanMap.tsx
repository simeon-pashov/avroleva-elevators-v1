import { useCallback, useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { DayPlanDto, PlanStopDto, UnplannedStopDto } from '@avroleva/contracts'
import { useI18n } from '../../i18n/I18nProvider'
import { planColour } from './planColours'
import { unplannedKey } from './planUtils'

const TILES =
  (import.meta.env.VITE_MAP_TILES_URL as string | undefined) ||
  'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const SOFIA: L.LatLngTuple = [42.6977, 23.3219]

const startIcon = L.divIcon({
  className: 'plan-pin plan-pin-start',
  html: '<span>⌂</span>',
  iconSize: [24, 24],
  iconAnchor: [12, 12],
})
const unplannedIcon = L.divIcon({
  className: 'plan-pin plan-pin-unplanned',
  html: '<span></span>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
})

/** Numbered pin in the plan's colour; "✓" once every stop at that point is done. */
function stopIcon(label: string, colour: string, done: boolean, skipped: boolean) {
  const cls = `plan-pin${done ? ' plan-pin-done' : skipped ? ' plan-pin-skipped' : ''}`
  return L.divIcon({
    className: cls,
    html: `<span style="background:${colour}">${done ? '✓' : label}</span>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  })
}

/** Tooltip DOM (Leaflet would treat a string as HTML; addresses are data). */
function tip(lines: string[]): HTMLElement {
  const root = document.createElement('div')
  root.className = 'plan-tip'
  for (const line of lines) {
    if (!line) continue
    const p = document.createElement('div')
    p.textContent = line
    root.append(p)
  }
  return root
}

const hasPoint = (s: {
  lat: number | null
  lng: number | null
}): s is { lat: number; lng: number } => s.lat !== null && s.lng !== null

function pointsOf(plans: DayPlanDto[], unplanned: UnplannedStopDto[]): L.LatLngTuple[] {
  const pts: L.LatLngTuple[] = []
  for (const p of plans) {
    if (p.start) pts.push([p.start.lat, p.start.lng])
    for (const s of p.stops) if (hasPoint(s)) pts.push([s.lat, s.lng])
  }
  for (const u of unplanned) if (hasPoint(u)) pts.push([u.lat, u.lng])
  return pts
}

interface PinGroup {
  lat: number
  lng: number
  stops: Array<{ seq: number; stop: PlanStopDto }>
}

/** Consecutive stops at one point (several lifts in a building) share one pin ("3–5"). */
function groupStops(stops: PlanStopDto[]): PinGroup[] {
  const groups: PinGroup[] = []
  const byKey = new Map<string, PinGroup>()
  stops.forEach((stop, i) => {
    if (!hasPoint(stop)) return
    const key = `${stop.lat},${stop.lng}`
    let g = byKey.get(key)
    if (!g) {
      g = { lat: stop.lat, lng: stop.lng, stops: [] }
      byKey.set(key, g)
      groups.push(g)
    }
    g.stops.push({ seq: i + 1, stop })
  })
  return groups
}

function groupLabel(g: PinGroup): string {
  const first = g.stops[0]
  const last = g.stops[g.stops.length - 1]
  if (!first || !last || g.stops.length === 1) return String(first?.seq ?? '')
  return `${first.seq}–${last.seq}`
}

/**
 * The day on a map: the base as a dark house pin, one polyline per plan in the plan's colour
 * from the base through its stops, numbered pins, and the unplanned stops as hollow grey pins.
 * Clicking a pin reports the stop id (or the unplanned key) so the board can scroll to the card.
 * The map is created once; every change of the plans redraws the overlay layer only.
 */
export function PlanMap({
  plans,
  unplanned,
  fitKey,
  onPick,
}: {
  plans: DayPlanDto[]
  unplanned: UnplannedStopDto[]
  /** Changes when a different day / zone is shown: the map re-fits to the new data. */
  fitKey: string
  onPick: (id: string) => void
}) {
  const { t } = useI18n()
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)
  const fittedKey = useRef<string | null>(null)
  const hadPoints = useRef(false)
  const onPickRef = useRef(onPick)
  const tRef = useRef(t)
  useEffect(() => {
    onPickRef.current = onPick
    tRef.current = t
  })

  const fitAll = useCallback(() => {
    const m = map.current
    if (!m) return
    const pts = pointsOf(plans, unplanned)
    if (pts.length === 0) return
    m.fitBounds(L.latLngBounds(pts), { padding: [32, 32], maxZoom: 15 })
  }, [plans, unplanned])

  // Create the map once; keep Leaflet's size in step with the layout (board beside / below).
  useEffect(() => {
    if (!el.current || map.current) return
    const m = L.map(el.current, { center: SOFIA, zoom: 12 })
    L.tileLayer(TILES, { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(m)
    layer.current = L.layerGroup().addTo(m)
    map.current = m
    const ro = new ResizeObserver(() => m.invalidateSize())
    ro.observe(el.current)
    return () => {
      ro.disconnect()
      m.remove()
      map.current = null
      layer.current = null
    }
  }, [])

  // Redraw the overlay whenever the plans change; fit on a new day / zone or the first points.
  useEffect(() => {
    const m = map.current
    const lg = layer.current
    if (!m || !lg) return
    lg.clearLayers()
    const starts = new Set<string>()
    plans.forEach((plan, i) => {
      const colour = planColour(i)
      const line: L.LatLngTuple[] = []
      if (plan.start) {
        line.push([plan.start.lat, plan.start.lng])
        const key = `${plan.start.lat},${plan.start.lng}`
        if (!starts.has(key)) {
          starts.add(key)
          L.marker([plan.start.lat, plan.start.lng], { icon: startIcon, zIndexOffset: 50 })
            .bindTooltip(tip([tRef.current('dayPlan.start')]), {
              direction: 'top',
              offset: [0, -12],
            })
            .addTo(lg)
        }
      }
      for (const s of plan.stops) if (hasPoint(s)) line.push([s.lat, s.lng])
      if (line.length > 1)
        L.polyline(line, { color: colour, weight: 3, opacity: 0.85, interactive: false }).addTo(lg)
      for (const g of groupStops(plan.stops)) {
        const done = g.stops.every((x) => x.stop.status === 'done')
        const skipped = !done && g.stops.every((x) => x.stop.status !== 'planned')
        const first = g.stops[0]
        if (!first) continue
        const mk = L.marker([g.lat, g.lng], {
          icon: stopIcon(groupLabel(g), colour, done, skipped),
          zIndexOffset: 100,
        })
        mk.bindTooltip(
          tip([
            plan.pairName ?? '',
            ...g.stops.map((x) => `${x.seq}. ${x.stop.elevatorInternalNo} · ${x.stop.label}`),
            first.stop.buildingAddressText,
          ]),
          { direction: 'top', offset: [0, -12] },
        )
        mk.on('click', () => onPickRef.current(first.stop.id))
        mk.addTo(lg)
      }
    })
    for (const u of unplanned) {
      if (!hasPoint(u)) continue
      const mk = L.marker([u.lat, u.lng], { icon: unplannedIcon })
      mk.bindTooltip(
        tip([
          tRef.current('dayPlan.unplanned'),
          `${u.elevatorInternalNo} · ${u.label}`,
          u.buildingAddressText,
        ]),
        { direction: 'top', offset: [0, -9] },
      )
      mk.on('click', () => onPickRef.current(unplannedKey(u)))
      mk.addTo(lg)
    }
    const pts = pointsOf(plans, unplanned)
    const newKey = fittedKey.current !== fitKey
    if (pts.length > 0 && (newKey || !hadPoints.current)) {
      m.fitBounds(L.latLngBounds(pts), { padding: [32, 32], maxZoom: 15 })
    }
    if (newKey) fittedKey.current = fitKey
    hadPoints.current = pts.length > 0
  }, [plans, unplanned, fitKey])

  return (
    <div className="plan-map-card">
      <div ref={el} className="map plan-map" />
      <div className="map-legend plan-legend">
        {plans.map((p, i) => (
          <span key={p.id} className="legend-item">
            <i className="legend-dot plan-legend-dot" style={{ background: planColour(i) }} />
            <span>{p.pairName ?? t('dayPlan.noPair')}</span>
            <b>{p.stops.length}</b>
          </span>
        ))}
        {unplanned.length > 0 ? (
          <span className="legend-item">
            <i className="legend-dot plan-legend-dot plan-legend-dot-unplanned" />
            <span>{t('dayPlan.unplanned')}</span>
            <b>{unplanned.length}</b>
          </span>
        ) : null}
        <span className="legend-spacer" />
        <button type="button" className="btn btn-small" onClick={fitAll}>
          {t('dashboard.showAll')}
        </button>
      </div>
    </div>
  )
}
