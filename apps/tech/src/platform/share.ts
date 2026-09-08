export interface ShareData {
  title?: string
  text?: string
  url?: string
}

/** Web Share API (fallback for "navigate" / sending an address on); Capacitor: @capacitor/share. */
export interface Share {
  canShare(): boolean
  /** Resolves true when the share sheet was opened. */
  share(data: ShareData): Promise<boolean>
}

export const webShare: Share = {
  canShare() {
    return typeof navigator.share === 'function'
  },
  async share(data) {
    if (typeof navigator.share !== 'function') return false
    try {
      await navigator.share(data)
      return true
    } catch {
      return false
    }
  },
}
