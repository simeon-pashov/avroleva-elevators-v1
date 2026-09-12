import express from 'express'
import type { Express } from 'express'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import rateLimit from 'express-rate-limit'
import { pinoHttp } from 'pino-http'
import { config } from './platform/config.js'
import { logger } from './platform/logger.js'
import { requestId } from './platform/http/requestId.js'
import { csrfGuard } from './platform/http/ctx.js'
import { errorHandler, notFound } from './platform/http/errors.js'
import { authenticate } from './modules/tenancy/index.js'
import { useScheduleRules } from './modules/registry/index.js'
import { scheduleRules } from './modules/maintenance/index.js'
import { useVisitRecorder } from './modules/callbacks/index.js'
import * as visits from './modules/visits/index.js'
import { checklists } from './modules/maintenance/index.js'
import { filesRouter } from './modules/documents/index.js'
import { exportFilesRouter, useReportNotifier } from './modules/reporting/index.js'
import * as notifications from './modules/notifications/index.js'
import { printRouter } from './http/print.js'
import { publicRouter } from './http/public.js'
import { apiV1 } from './http/router.js'
import { mountOffice, mountTech } from './http/static.js'
import { MIN_CLIENT_VERSION_HEADER } from '@avroleva/contracts'

// Composition root (ARCHITECTURE section 1.1 rule 2): the registry's schedule port gets the
// maintenance module's cycle engine; nothing below L3 imports maintenance directly.
useScheduleRules(scheduleRules)
// callbacks (L3) records its close-out visit through a port; visits (L3) implements it here.
useVisitRecorder({ record: visits.record })
// visits (L3) snapshots checklist answers through a port; maintenance (L3) owns the templates.
visits.useChecklistResolver({ snapshotFor: checklists.snapshotFor })
// reporting (L4) e-mails reports / export links through a port; notifications (L4) implements it.
useReportNotifier({ sendEmail: notifications.sendEmail, notifyUsers: notifications.notifyUsers })

export interface AppOptions {
  /** Absolute path of the built office SPA; omitted = API only (dev, tests). */
  officeDist?: string
  /** Absolute path of the built technician app (served at /tech/). */
  techDist?: string
}

export function createApp(opts: AppOptions = {}): Express {
  const app = express()
  app.disable('x-powered-by')
  if (config.COOKIE_SECURE) app.set('trust proxy', 1)

  app.use(requestId)
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: [
            "'self'",
            'data:',
            'https://*.tile.openstreetmap.org',
            'https://tile.openstreetmap.org',
            'https://*.openstreetmap.org',
          ],
          connectSrc: ["'self'"],
          fontSrc: ["'self'", 'data:'],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
      // OpenStreetMap's tile servers need a Referer to identify the calling app;
      // helmet's default 'no-referrer' makes them serve a 403 "Access blocked" tile
      // instead of the map. 'strict-origin-when-cross-origin' sends only our origin
      // cross-site - never a path, query string or tenant-identifying data.
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  )
  if (config.NODE_ENV !== 'test') {
    app.use(
      pinoHttp({
        logger,
        genReqId: (req) => req.requestId,
        customProps: (req) => ({ tenantId: req.ctx?.tenantId, userId: req.ctx?.userId }),
        autoLogging: { ignore: (req) => req.url === '/api/v1/health' },
      }),
    )
  }
  app.use(express.json({ limit: '6mb' }))
  app.use(cookieParser())

  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 600,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => config.NODE_ENV === 'test',
  })

  // Forced-update flow of the technician app (ARCHITECTURE section 4/5): every API answer says
  // which client build is still accepted.
  app.use('/api', (_req, res, next) => {
    res.setHeader(MIN_CLIENT_VERSION_HEADER, config.MIN_CLIENT_VERSION)
    next()
  })
  app.use('/api', apiLimiter, authenticate, csrfGuard)
  app.use('/api/v1', apiV1)
  app.use('/api', (_req, _res, next) => next(notFound('error.routeNotFound')))
  // Server-rendered pages: printable documents for signed-in office users (cookie, GET only, so no
  // CSRF header) and the public QR page + fault form (no auth, rate-limited, form-encoded).
  app.use('/print', authenticate, printRouter)
  app.use('/p', express.urlencoded({ extended: false, limit: '32kb' }), publicRouter)
  // Signed file URLs: the signature is the authorisation (no cookie, no CSRF header), so <img>
  // tags in the office and in the technician app just work.
  app.use('/files/export', exportFilesRouter)
  app.use('/files', filesRouter)

  if (opts.techDist) mountTech(app, opts.techDist)
  if (opts.officeDist) mountOffice(app, opts.officeDist)

  app.use(errorHandler)
  return app
}
