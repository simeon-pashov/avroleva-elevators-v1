import type { Geolocation } from '../geolocation'

/**
 * @capacitor/geolocation with the same contract as the web adapter: never throws, never blocks
 * longer than `timeoutMs`, and only asks for the permission when the tenant feature is on
 * (the caller decides, as on the web).
 */
export const nativeGeolocation: Geolocation = {
  async getPosition(timeoutMs = 5000) {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs)
    })
    const read = (async () => {
      try {
        const { Geolocation: plugin } = await import('@capacitor/geolocation')
        const perm = await plugin.checkPermissions()
        if (perm.location !== 'granted' && perm.coarseLocation !== 'granted') {
          const asked = await plugin.requestPermissions({ permissions: ['location'] })
          if (asked.location !== 'granted' && asked.coarseLocation !== 'granted') return null
        }
        const pos = await plugin.getCurrentPosition({
          enableHighAccuracy: false,
          timeout: timeoutMs,
          maximumAge: 60_000,
        })
        return {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: Math.min(100_000, Math.round(pos.coords.accuracy)),
        }
      } catch {
        return null
      }
    })()
    try {
      return await Promise.race([read, timeout])
    } finally {
      clearTimeout(timer)
    }
  },
}
