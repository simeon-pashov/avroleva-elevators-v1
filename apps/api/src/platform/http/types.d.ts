import type { Ctx, AdminCtx } from './ctx.js'

declare global {
  namespace Express {
    interface Request {
      requestId: string
      /** Locale for unauthenticated responses (Accept-Language or 'bg'); ctx.locale wins when present. */
      locale?: string
      ctx?: Ctx
      admin?: AdminCtx
      authVia?: 'cookie' | 'bearer'
    }
  }
}

export {}
