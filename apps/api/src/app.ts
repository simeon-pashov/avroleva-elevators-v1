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
import { appCors } from './platform/http/cors.js'
import { errorHandler, notFound } from './platform/http/errors.js'
import { authenticate } from './modules/tenancy/index.js'
import { filesRouter } from './modules/documents/index.js'
import { exportFilesRouter } from './modules/reporting/index.js'
import { wireModules } from './wiring.js'
import { printRouter } from './http/print.js'
import { publicRouter } from './http/public.js'
import { statementRouter } from './http/statement.js'
import { downloadsRouter } from './http/downloads.js'
import { payRouter, webhookRouter } from './http/pay.js'
import { apiV1 } from './http/router.js'
import { mountOffice, mountTech } from './http/static.js'
import { MIN_CLIENT_VERSION_HEADER } from '@avroleva/contracts'

// Composition root of the module ports (ARCHITECTURE section 1.1 rule 2) - see wiring.ts.
wireModules()

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
  // Native technician app (Capacitor WebView origin): CORS with credentials, preflights first.
  app.use('/api', appCors)
  app.use('/api', apiLimiter, authenticate, csrfGuard)
  app.use('/api/v1', apiV1)
  app.use('/api', (_req, _res, next) => next(notFound('error.routeNotFound')))
  // Server-rendered pages: printable documents for signed-in office users (cookie, GET only, so no
  // CSRF header) and the public QR page + fault form (no auth, rate-limited, form-encoded).
  app.use('/print', authenticate, printRouter)
  app.use('/p', express.urlencoded({ extended: false, limit: '32kb' }), publicRouter)
  // Building statement behind a magic link (step 9): token-authorised, no login, form-encoded pay.
  app.use('/s', express.urlencoded({ extended: false, limit: '8kb' }), statementRouter)
  // Hosted payment pages (demo adapter, token-authorised) and provider webhooks (raw body).
  app.use('/pay', payRouter)
  app.use('/webhooks/payments', webhookRouter)
  // Signed file URLs: the signature is the authorisation (no cookie, no CSRF header), so <img>
  // tags in the office and in the technician app just work.
  app.use('/files', appCors)
  app.use('/files/export', exportFilesRouter)
  app.use('/files', filesRouter)
  // Sideloading page + APK of the native technician app (DATA_DIR/releases/tech.apk).
  app.use('/downloads', downloadsRouter)

  if (opts.techDist) mountTech(app, opts.techDist)
  if (opts.officeDist) mountOffice(app, opts.officeDist)

  app.use(errorHandler)
  return app
}
