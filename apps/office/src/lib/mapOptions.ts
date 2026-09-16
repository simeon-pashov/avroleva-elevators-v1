import L from 'leaflet'

/**
 * Leaflet options shared by every map in the office app (dashboard, building picker,
 * place-on-map dialog, day-plan route map, zone editor) so they all behave the same.
 *
 * Leaflet's defaults zoom a whole level per wheel notch, which feels like a jump. Fractional
 * zoom (`zoomSnap` < 1, supported since Leaflet 1.0 and stable in 1.9) plus a larger
 * `wheelPxPerZoomLevel` turns the wheel into a smooth quarter/half-level glide.
 * `scrollWheelZoom` is Leaflet's default but is spelled out here so nothing silently drops it.
 */
export const MAP_OPTIONS: L.MapOptions = {
  zoomSnap: 0.25,
  zoomDelta: 0.5,
  wheelPxPerZoomLevel: 120,
  wheelDebounceTime: 40,
  zoomAnimation: true,
  scrollWheelZoom: true,
}

/**
 * Stop an overlay element that sits on top of a map (search box, results list, action bar)
 * from driving the map underneath: clicks and drags on it must not pan, and its own wheel
 * scrolling (a long results list) must not zoom. Safe to call on elements that are not over a
 * map — Leaflet only attaches listeners.
 *
 * Use as a React ref callback: `ref={tameMapOverlay}`.
 */
export function tameMapOverlay(el: HTMLElement | null): void {
  if (!el) return
  L.DomEvent.disableClickPropagation(el)
  L.DomEvent.disableScrollPropagation(el)
}
