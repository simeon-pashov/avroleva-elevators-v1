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
  /** Building statement page behind a magic link (step 9). */
  statementPage(token: string): string {
    return `${urls.base()}/s/${token}`
  },
  /** Technician app (served at /tech/ by the API). */
  techApp(): string {
    return `${urls.base()}/tech/`
  },
  /** QR payload of a device enrollment: the app opens with the code and enrolls itself. */
  techEnroll(code: string): string {
    return `${urls.techApp()}?enroll=${encodeURIComponent(code)}`
  },
}
