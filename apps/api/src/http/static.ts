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
  app.get(
    /^(?!\/api\/|\/print\/|\/p\/|\/pay\/|\/webhooks\/|\/files\/|\/tech(\/|$)).*/,
    (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache')
      res.sendFile(index)
    },
  )
}

/**
 * Serves the built technician PWA (apps/tech/dist, built with VITE_TECH_BASE=<BASE_PATH>/tech/)
 * at /tech/. index.html, the service worker and the manifest are `no-cache` so a new build is
 * picked up on the next visit; hashed assets under /assets/ are immutable for a year.
 */
export function mountTech(app: Express, distDir: string): void {
  const index = join(distDir, 'index.html')
  if (!existsSync(index)) {
    logger.warn(
      { distDir },
      'tech dist not found - technician app not served (run `npm run build -w apps/tech`)',
    )
    return
  }
  // Exact match only: Express 5 treats the trailing slash as optional, so '/tech' would also
  // catch '/tech/' and redirect it to itself forever.
  app.get(/^\/tech$/, (_req, res) => res.redirect(301, '/tech/'))
  app.use(
    '/tech',
    express.static(distDir, {
      index: false,
      setHeaders: (res, path) => {
        if (path.replace(/\\/g, '/').includes('/assets/'))
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        else res.setHeader('Cache-Control', 'no-cache')
      },
    }),
  )
  app.get(/^\/tech\/.*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache')
    res.sendFile(index)
  })
}
