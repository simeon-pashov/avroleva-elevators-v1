import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { BuildingPinDto, GeoJsonPolygon, ZoneDto } from '@avroleva/contracts'
import { useI18n } from '../../i18n/I18nProvider'

const TILES =
  (import.meta.env.VITE_MAP_TILES_URL as string | undefined) ||
  'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const SOFIA: L.LatLngTuple = [42.6977, 23.3219]

/** A polygon vertex as the map sees it: [lat, lng]. */
export type Vertex = [number, number]

const vertexIcon = L.divIcon({ className: 'zone-vertex', iconSize: [12, 12], iconAnchor: [6, 6] })

/** GeoJSON ring ([lng, lat], closed) -> editable vertices ([lat, lng], open). */
export function polygonToVertices(polygon: GeoJsonPolygon | null): Vertex[] {
  const ring = polygon?.coordinates[0] ?? []
  const verts: Vertex[] = ring.map(([lng, lat]) => [lat, lng])
  const first = verts[0]
  const last = verts[verts.length - 1]
  if (verts.length > 1 && first && last && first[0] === last[0] && first[1] === last[1]) verts.pop()
  return verts
}

/** Editable vertices -> GeoJSON Polygon with a closed ring; null when there is no real polygon. */
export function verticesToPolygon(verts: Vertex[]): GeoJsonPolygon | null {
  if (verts.length < 3) return null
  const ring = verts.map(([lat, lng]) => [lng, lat] as [number, number])
  const first = ring[0]
  if (!first) return null
  return { type: 'Polygon', coordinates: [[...ring, first]] }
}

const round = (n: number) => Math.round(n * 1e6) / 1e6

export interface ZoneMapEditorProps {
  /** The other zones, drawn for context in their colour. */
  others: ZoneDto[]
  /** Every building with coordinates, drawn as tiny dots. */
  pins: BuildingPinDto[]
  vertices: Vertex[]
  onChange: (vertices: Vertex[]) => void
  editable: boolean
  height?: number
}

/**
 * Leaflet map for drawing one zone polygon: click appends a vertex, vertices drag, the other
 * zones and the building pins stay visible so the boundary can follow the real buildings.
 */
export function ZoneMapEditor({
  others,
  pins,
  vertices,
  onChange,
  editable,
  height = 380,
}: ZoneMapEditorProps) {
  const { t } = useI18n()
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const othersLayer = useRef<L.LayerGroup | null>(null)
  const pinsLayer = useRef<L.LayerGroup | null>(null)
  const editLayer = useRef<L.LayerGroup | null>(null)
  const verticesRef = useRef(vertices)
  const onChangeRef = useRef(onChange)
  const editableRef = useRef(editable)
  useEffect(() => {
    verticesRef.current = vertices
    onChangeRef.current = onChange
    editableRef.current = editable
  })

  // Map once; the view fits the polygon being edited, else the tenant's pins, else Sofia.
  useEffect(() => {
    if (!el.current || map.current) return
    const m = L.map(el.current, { center: SOFIA, zoom: 11 })
    L.tileLayer(TILES, { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(m)
    othersLayer.current = L.layerGroup().addTo(m)
    pinsLayer.current = L.layerGroup().addTo(m)
    editLayer.current = L.layerGroup().addTo(m)
    const pts: L.LatLng[] =
      verticesRef.current.length >= 3
        ? verticesRef.current.map(([lat, lng]) => L.latLng(lat, lng))
        : pins.map((p) => L.latLng(p.lat, p.lng))
    if (pts.length > 0) m.fitBounds(L.latLngBounds(pts), { padding: [32, 32], maxZoom: 15 })
    m.on('click', (e: L.LeafletMouseEvent) => {
      if (!editableRef.current) return
      onChangeRef.current([...verticesRef.current, [round(e.latlng.lat), round(e.latlng.lng)]])
    })
    map.current = m
    return () => {
      m.remove()
      map.current = null
      othersLayer.current = null
      pinsLayer.current = null
      editLayer.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const g = othersLayer.current
    if (!g) return
    g.clearLayers()
    for (const z of others) {
      const verts = polygonToVertices(z.polygon)
      if (verts.length < 3) continue
      L.polygon(verts, { color: z.colour, weight: 2, fillOpacity: 0.15, interactive: false })
        .bindTooltip(z.name, { sticky: true, className: 'zone-tooltip' })
        .addTo(g)
    }
  }, [others])

  useEffect(() => {
    const g = pinsLayer.current
    if (!g) return
    g.clearLayers()
    for (const p of pins) {
      L.circleMarker([p.lat, p.lng], {
        radius: 3,
        color: '#1e293b',
        weight: 1,
        fillColor: '#475569',
        fillOpacity: 0.8,
        interactive: false,
      }).addTo(g)
    }
  }, [pins])

  useEffect(() => {
    const g = editLayer.current
    if (!g) return
    g.clearLayers()
    if (vertices.length === 0) return
    if (vertices.length >= 3) {
      L.polygon(vertices, {
        color: '#2563eb',
        weight: 2,
        fillOpacity: 0.25,
        interactive: false,
      }).addTo(g)
    } else {
      L.polyline(vertices, { color: '#2563eb', weight: 2, interactive: false }).addTo(g)
    }
    vertices.forEach((v, i) => {
      const mk = L.marker(v, { icon: vertexIcon, draggable: editable }).addTo(g)
      mk.on('dragend', () => {
        const p = mk.getLatLng()
        const next = verticesRef.current.slice()
        next[i] = [round(p.lat), round(p.lng)]
        onChangeRef.current(next)
      })
    })
  }, [vertices, editable])

  return (
    <div className="map-wrap zone-map">
      <div ref={el} style={{ height }} className="map" />
      <div className="zone-map-bar">
        <span className="map-hint muted">
          {editable
            ? t('zones.polygonHint', { count: vertices.length })
            : t('zones.polygonReadOnly')}
        </span>
        {editable ? (
          <span className="actions">
            <button
              type="button"
              className="btn btn-small"
              disabled={vertices.length === 0}
              onClick={() => onChange(vertices.slice(0, -1))}
            >
              {t('zones.undoPoint')}
            </button>
            <button
              type="button"
              className="btn btn-small"
              disabled={vertices.length === 0}
              onClick={() => onChange([])}
            >
              {t('zones.clear')}
            </button>
          </span>
        ) : null}
      </div>
    </div>
  )
}
