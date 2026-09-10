/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Default server of the build: API origin, or origin + BASE_PATH (e.g.
   * `https://srv1662742.hstgr.cloud/avroleva`). Empty = same origin as the app. The user can
   * override it at runtime (Enroll screen / Settings). Required for the native (Capacitor) build.
   */
  readonly VITE_DEFAULT_API_ORIGIN?: string
  /** Older name of VITE_DEFAULT_API_ORIGIN, still honoured. */
  readonly VITE_API_BASE?: string
  /** Build version, injected by vite.config.ts from package.json unless set explicitly. */
  readonly VITE_APP_VERSION?: string
  /** '1' in the Capacitor build (`npm run build:native`): base '/', no service worker. */
  readonly VITE_NATIVE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
