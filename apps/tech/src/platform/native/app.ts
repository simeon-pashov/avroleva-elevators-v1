import type { AppPlugin } from '@capacitor/app'
import type { AppHost } from '../appHost'

let appMod: Promise<AppPlugin> | undefined
function app(): Promise<AppPlugin> {
  appMod ??= import('@capacitor/app').then((m) => m.App)
  return appMod
}

/** Wraps a plugin listener registration into a synchronous unsubscribe. */
function listen(register: () => Promise<{ remove: () => Promise<void> }>): () => void {
  let removed = false
  const handle = register().catch(() => undefined)
  return () => {
    removed = true
    void handle.then((h) => (removed && h ? h.remove() : undefined))
  }
}

export const nativeAppHost: AppHost = {
  onResume(cb) {
    return listen(async () => (await app()).addListener('resume', () => cb()))
  },
  onUrlOpen(cb) {
    return listen(async () => (await app()).addListener('appUrlOpen', (e) => cb(e.url)))
  },
  onBackButton(cb) {
    return listen(async () => (await app()).addListener('backButton', (e) => cb(e.canGoBack)))
  },
  ready() {
    void import('@capacitor/splash-screen')
      .then(({ SplashScreen }) => SplashScreen.hide())
      .catch(() => undefined)
    void import('@capacitor/status-bar')
      .then(async ({ StatusBar, Style }) => {
        await StatusBar.setStyle({ style: Style.Light })
        await StatusBar.setBackgroundColor({ color: '#1d5fd1' })
      })
      .catch(() => undefined)
  },
  async takeLaunchUrl() {
    try {
      const launch = await (await app()).getLaunchUrl()
      return launch?.url ?? null
    } catch {
      return null
    }
  },
  exit() {
    void app()
      .then((a) => a.exitApp())
      .catch(() => undefined)
  },
}
