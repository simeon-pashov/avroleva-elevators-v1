import type { Camera } from '../camera'

/**
 * @capacitor/camera: opens the native camera (with the gallery as a fallback the user can pick)
 * and hands the picture back as a File, so the same downscale + sha256 pipeline (`lib/photos`)
 * runs exactly as on the web. `webPath` is a WebView-readable URL of the temp file; the plugin's
 * own resizing is left off - `processPhoto` owns the 1600 px / q0.8 rule.
 */
export const nativeCamera: Camera = {
  async pickPhoto() {
    const { Camera: plugin, CameraResultType, CameraSource } = await import('@capacitor/camera')
    let photo: { webPath?: string; path?: string; format: string }
    try {
      photo = await plugin.getPhoto({
        resultType: CameraResultType.Uri,
        source: CameraSource.Prompt,
        quality: 90,
        correctOrientation: true,
        saveToGallery: false,
        promptLabelHeader: 'Снимка',
        promptLabelPhoto: 'От галерията',
        promptLabelPicture: 'Снимай',
        promptLabelCancel: 'Отказ',
      })
    } catch {
      // Cancelled or permission refused: the caller treats null as "no photo".
      return null
    }
    const url = photo.webPath ?? photo.path
    if (!url) return null
    try {
      const res = await fetch(url)
      if (!res.ok) return null
      const blob = await res.blob()
      const type = blob.type || `image/${photo.format || 'jpeg'}`
      return new File([blob], `photo.${photo.format || 'jpg'}`, {
        type,
        lastModified: Date.now(),
      })
    } catch {
      return null
    }
  },
}
