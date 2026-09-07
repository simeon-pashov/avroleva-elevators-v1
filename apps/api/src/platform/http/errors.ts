import type { ErrorRequestHandler, Request } from 'express'
import { ZodError } from 'zod'
import type { Problem } from '@avroleva/contracts'
import { translate } from '@avroleva/i18n'
import type { Params } from '@avroleva/i18n'
import { logger } from '../logger.js'
import { TenantScopeError } from '../db/prisma.js'

export interface FieldIssue {
  path: string
  code: string
  params?: Params
}

/** Application error whose `code` is an i18n key (resolved in the tenant's locale by the handler). */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly options: { detail?: string; params?: Params; fields?: FieldIssue[] } = {},
  ) {
    super(code)
    this.name = 'AppError'
  }
}

export const notFound = (code = 'error.notFound') => new AppError(404, code)
export const badRequest = (code: string, params?: Params) => new AppError(400, code, { params })
export const unauthorized = (code = 'auth.required') => new AppError(401, code)
export const forbidden = (code = 'auth.forbidden') => new AppError(403, code)
export const conflict = (code: string, params?: Params) => new AppError(409, code, { params })

const I18N_KEY = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/

function zodIssueToField(issue: ZodError['issues'][number]): FieldIssue {
  const path = issue.path.map(String).join('.')
  const msg = issue.message
  if (I18N_KEY.test(msg)) return { path, code: msg }
  switch (issue.code) {
    case 'invalid_type':
      return { path, code: 'validation.invalidType' }
    case 'too_small':
      return { path, code: 'validation.tooSmall', params: { min: String(issue.minimum) } }
    case 'too_big':
      return { path, code: 'validation.tooBig', params: { max: String(issue.maximum) } }
    case 'invalid_format':
      return { path, code: 'validation.invalidFormat' }
    case 'invalid_value':
      return { path, code: 'validation.invalidValue' }
    case 'unrecognized_keys':
      return { path, code: 'validation.unrecognizedKeys' }
    default:
      return { path, code: 'validation.invalid' }
  }
}

export function toProblem(err: unknown, req: Request): Problem {
  const locale = req.ctx?.locale ?? req.locale ?? 'bg'
  const t = (key: string, params?: Params) => translate(locale, key, params)
  const base = { type: 'about:blank', requestId: req.requestId }

  if (err instanceof ZodError) {
    const fields = err.issues.map(zodIssueToField).map((f) => ({
      path: f.path,
      code: f.code,
      message: t(f.code, f.params),
    }))
    return { ...base, title: t('error.validation'), status: 400, code: 'error.validation', fields }
  }
  if (err instanceof AppError) {
    const fields = err.options.fields?.map((f) => ({
      path: f.path,
      code: f.code,
      message: t(f.code, f.params),
    }))
    return {
      ...base,
      title: t(err.code, err.options.params),
      status: err.status,
      code: err.code,
      detail: err.options.detail,
      ...(fields ? { fields } : {}),
    }
  }
  if (err instanceof TenantScopeError) {
    return { ...base, title: t('error.internal'), status: 500, code: 'error.internal' }
  }
  const e = err as { status?: number; type?: string; code?: string }
  if (e?.type === 'entity.parse.failed' || e?.code === 'INVALID_JSON') {
    return { ...base, title: t('error.badJson'), status: 400, code: 'error.badJson' }
  }
  if (e?.type === 'entity.too.large') {
    return {
      ...base,
      title: t('error.payloadTooLarge'),
      status: 413,
      code: 'error.payloadTooLarge',
    }
  }
  return { ...base, title: t('error.internal'), status: 500, code: 'error.internal' }
}

/** RFC 7807 error handler (ARCHITECTURE section 5). */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const problem = toProblem(err, req)
  if (problem.status >= 500) {
    logger.error({ err, requestId: req.requestId, url: req.originalUrl }, 'unhandled error')
  }
  res.status(problem.status).type('application/problem+json').json(problem)
}
