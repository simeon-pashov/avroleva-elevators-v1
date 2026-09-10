import type * as AppModule from '@capacitor/app'
import type { AppHost } from '../appHost'

// Resolve with the module, never with the plugin: the plugin proxy is a thenable and would hang
// every promise settled with it (see native/preferences.ts).
let appMod: Promise<typeof AppModule> | undefined
function app(): Promise<typeof AppModule> {
  appMod ??= import('@capacitor/app')
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
    return listen(async () => (await app()).App.addListener('resume', () => cb()))
  },
  onUrlOpen(cb) {
    return listen(async () => (await app()).App.addListener('appUrlOpen', (e) => cb(e.url)))
  },
  onBackButton(cb) {
    return listen(async () => (await app()).App.addListener('backButton', (e) => cb(e.canGoBack)))
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
      const launch = await (await app()).App.getLaunchUrl()
      return launch?.url ?? null
    } catch {
      return null
    }
  },
  exit() {
    void app()
      .then((m) => m.App.exitApp())
      .catch(() => undefined)
  },
}
