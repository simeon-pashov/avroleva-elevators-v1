/**
 * Native-shell detection without importing @capacitor/core into the web bundle: the Capacitor
 * runtime injects `window.Capacitor` into its WebView before any app script runs. The build-time
 * flag (`VITE_NATIVE=1`, set by `build:native`) keeps the PWA build from ever taking the native
 * branch, even inside an unrelated WebView that happens to expose a `Capacitor` global.
 */
interface CapacitorGlobal {
  isNativePlatform?: () => boolean
  getPlatform?: () => string
}

function capacitorGlobal(): CapacitorGlobal | undefined {
  return (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor
}

export function isNativePlatform(): boolean {
  if (import.meta.env.VITE_NATIVE !== '1') return false
  return capacitorGlobal()?.isNativePlatform?.() === true
}

/** 'android' | 'ios' inside the shell, 'web' otherwise. */
export function platformName(): string {
  return isNativePlatform() ? (capacitorGlobal()?.getPlatform?.() ?? 'native') : 'web'
}
