import type { Share } from '../share'

/** @capacitor/share: the Android share sheet. Always available inside the shell. */
export const nativeShare: Share = {
  canShare() {
    return true
  },
  async share(data) {
    try {
      const { Share: plugin } = await import('@capacitor/share')
      await plugin.share({ title: data.title, text: data.text, url: data.url })
      return true
    } catch {
      return false
    }
  },
}
