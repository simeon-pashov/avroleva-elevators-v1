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
import { apiV1 } from './http/router.js'
import { mountOffice } from './http/static.js'

// Composition root (ARCHITECTURE section 1.1 rule 2): the registry's schedule port gets the
// maintenance module's cycle engine; nothing below L3 imports maintenance directly.
useScheduleRules(scheduleRules)

export interface AppOptions {
  /** Absolute path of the built office SPA; omitted = API only (dev, tests). */
  officeDist?: string
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

  app.use('/api', apiLimiter, authenticate, csrfGuard)
  app.use('/api/v1', apiV1)
  app.use('/api', (_req, _res, next) => next(notFound('error.routeNotFound')))

  if (opts.officeDist) mountOffice(app, opts.officeDist)

  app.use(errorHandler)
  return app
}
