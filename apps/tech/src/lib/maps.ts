const isApple = () =>
  /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

/** Deep link to the platform's maps app; no map tiles in the technician app (ARCHITECTURE §4). */
export function navigationUrl(lat: number, lng: number): string {
  if (isApple()) return `https://maps.apple.com/?daddr=${lat},${lng}`
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
}

/** Best-effort device model from the user agent, used as the default device name. */
export function guessDeviceName(): string {
  const ua = navigator.userAgent
  const android = /Android[^;]*;\s*([^;)]+?)(?:\s+Build|\))/i.exec(ua)
  if (android?.[1]) return android[1].trim()
  if (/iPhone/i.test(ua)) return 'iPhone'
  if (/iPad/i.test(ua)) return 'iPad'
  return ''
}
