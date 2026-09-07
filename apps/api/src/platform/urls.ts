import { config } from './config.js'

/**
 * Every generated absolute link goes through here (ARCHITECTURE A11): PUBLIC_BASE_URL + BASE_PATH
 * today, `app.avroleva.bg` tomorrow, without touching QR labels or letters.
 */
export const urls = {
  base(): string {
    const origin = config.PUBLIC_BASE_URL.replace(/\/$/, '')
    return config.BASE_PATH === '/' ? origin : `${origin}${config.BASE_PATH}`
  },
  /** Public QR page of an elevator. */
  publicPage(token: string): string {
    return `${urls.base()}/p/${token}`
  },
}
