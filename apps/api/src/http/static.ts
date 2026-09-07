import express from 'express'
import type { Express } from 'express'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from '../platform/logger.js'

/**
 * Serves the built office SPA (apps/office/dist) with an SPA fallback. In production the same
 * container serves API + SPA (VPS-GUIDE). `basePath` is stripped by nginx, so we mount at "/".
 */
export function mountOffice(app: Express, distDir: string): void {
  const index = join(distDir, 'index.html')
  if (!existsSync(index)) {
    logger.warn(
      { distDir },
      'office dist not found - SPA not served (run `npm run build -w apps/office`)',
    )
    return
  }
  app.use(express.static(distDir, { index: false, maxAge: '1h' }))
  app.get(/^(?!\/api\/|\/print\/|\/p\/).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache')
    res.sendFile(index)
  })
}
