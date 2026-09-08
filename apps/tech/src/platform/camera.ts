/** Photo capture. Web: the file input with `capture`; Capacitor: @capacitor/camera. */
export interface Camera {
  /** Resolves with the picked file, or null when the user cancels. */
  pickPhoto(): Promise<File | null>
}

export const webCamera: Camera = {
  pickPhoto() {
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/*'
      input.setAttribute('capture', 'environment')
      input.style.display = 'none'
      let settled = false
      const finish = (file: File | null) => {
        if (settled) return
        settled = true
        input.remove()
        resolve(file)
      }
      input.addEventListener('change', () => finish(input.files?.[0] ?? null))
      input.addEventListener('cancel', () => finish(null))
      document.body.appendChild(input)
      input.click()
    })
  },
}
