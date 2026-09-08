/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API origin (or origin + BASE_PATH); empty = same origin as the app. */
  readonly VITE_API_BASE?: string
  /** Build version, injected by vite.config.ts from package.json unless set explicitly. */
  readonly VITE_APP_VERSION?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
