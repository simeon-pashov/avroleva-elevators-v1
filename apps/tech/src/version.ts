/** Build version sent as X-Client-Version and compared with X-Min-Client-Version (semver). */
export const APP_VERSION: string = import.meta.env.VITE_APP_VERSION || '0.0.0'
