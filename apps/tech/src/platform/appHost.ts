import { isNativePlatform } from './native'
import { nativeAppHost } from './native/app'

/**
 * The shell around the web app: lifecycle (resume), deep links (`avroleva-elevators://enroll` or
 * the `/tech/?enroll=` https link), the hardware back button and the splash screen. Web: only
 * `resume` maps to the visibility change; the rest are no-ops.
 */
export interface AppHost {
  /** The app comes back to the foreground. */
  onResume(cb: () => void): () => void
  /** The app was opened (or brought to the front) through a URL. */
  onUrlOpen(cb: (url: string) => void): () => void
  /** Android back button; `canGoBack` says whether the router has history to pop. */
  onBackButton(cb: (canGoBack: boolean) => void): () => void
  /** First render done: hide the splash screen, set the status bar. */
  ready(): void
  /** URL the app was launched with (cold start through a deep link), consumed once. */
  takeLaunchUrl(): Promise<string | null>
  /** Leaves the app (Android back button on the root screen). No-op on the web. */
  exit(): void
}

export const webAppHost: AppHost = {
  onResume(cb) {
    const on = () => {
      if (document.visibilityState === 'visible') cb()
    }
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  },
  onUrlOpen() {
    return () => undefined
  },
  onBackButton() {
    return () => undefined
  },
  ready() {
    /* nothing to hide */
  },
  takeLaunchUrl() {
    return Promise.resolve(null)
  },
  exit() {
    /* the browser owns navigation */
  },
}

export const appHost: AppHost = isNativePlatform() ? nativeAppHost : webAppHost
