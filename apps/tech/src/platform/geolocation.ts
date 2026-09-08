import type { GpsPoint } from '@avroleva/contracts'

/** Position at submit time; only asked when the tenant feature `gpsCapture` is on. Never blocks. */
export interface Geolocation {
  getPosition(timeoutMs?: number): Promise<GpsPoint | null>
}

export const webGeolocation: Geolocation = {
  getPosition(timeoutMs = 5000) {
    if (!('geolocation' in navigator)) return Promise.resolve(null)
    return new Promise((resolve) => {
      let done = false
      const finish = (p: GpsPoint | null) => {
        if (done) return
        done = true
        clearTimeout(timer)
        resolve(p)
      }
      const timer = setTimeout(() => finish(null), timeoutMs)
      try {
        navigator.geolocation.getCurrentPosition(
          (pos) =>
            finish({
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              accuracy: Math.min(100_000, Math.round(pos.coords.accuracy)),
            }),
          () => finish(null),
          { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 60_000 },
        )
      } catch {
        finish(null)
      }
    })
  },
}
