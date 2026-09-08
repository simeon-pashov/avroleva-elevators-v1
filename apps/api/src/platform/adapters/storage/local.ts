import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, normalize, resolve, sep } from 'node:path'
import type { FileStorage, StoredFile } from '../../ports/storage.js'

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
}

/**
 * Local-disk adapter: `<root>/<key>`. The key is validated against path traversal, the parent
 * directory is created on demand, writes go through a temp file + rename so a crash never leaves a
 * half-written photo behind.
 */
export function createLocalStorage(rootDir: string): FileStorage {
  const root = resolve(rootDir)

  function pathOf(key: string): string {
    const clean = normalize(key).replace(/^([/\\])+/, '')
    if (clean.split(/[/\\]/).includes('..')) throw new Error(`invalid storage key: ${key}`)
    const full = join(root, clean)
    if (!full.startsWith(root + sep) && full !== root)
      throw new Error(`invalid storage key: ${key}`)
    return full
  }

  return {
    name: 'local',
    async put(key, bytes) {
      const full = pathOf(key)
      await mkdir(dirname(full), { recursive: true })
      const tmp = `${full}.${process.pid}.${Date.now()}.tmp`
      await writeFile(tmp, bytes)
      await rename(tmp, full)
    },
    async get(key): Promise<StoredFile | null> {
      const full = pathOf(key)
      try {
        const bytes = await readFile(full)
        const ext = full.slice(full.lastIndexOf('.')).toLowerCase()
        return { bytes, mime: MIME_BY_EXT[ext] ?? 'application/octet-stream' }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw err
      }
    },
    async exists(key) {
      try {
        await stat(pathOf(key))
        return true
      } catch {
        return false
      }
    },
    async remove(key) {
      await rm(pathOf(key), { force: true })
    },
  }
}
