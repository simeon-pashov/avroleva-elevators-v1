import { Router } from 'express'
import multer from 'multer'
import { ATTACHMENT_MAX_BYTES, fileQuery, uploadAttachmentFields } from '@avroleva/contracts'
import { ctxOf, requireAuth } from '../../../platform/http/ctx.js'
import { AppError } from '../../../platform/http/errors.js'
import { parseId } from '../../../platform/http/validate.js'
import { verifyFileSignature } from '../../../platform/signedUrl.js'
import * as service from '../service.js'

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: ATTACHMENT_MAX_BYTES, files: 1, fields: 8 },
})

/** `/api/v1/attachments` - authenticated upload + metadata. */
export const attachmentsRouter = Router()
attachmentsRouter.use(requireAuth)

attachmentsRouter.post(
  '/attachments',
  (req, res, next) => {
    upload.single('file')(req, res, (err: unknown) => {
      if (err) {
        const code = (err as { code?: string }).code
        return next(
          new AppError(
            code === 'LIMIT_FILE_SIZE' ? 413 : 400,
            code === 'LIMIT_FILE_SIZE' ? 'error.payloadTooLarge' : 'attachments.badUpload',
          ),
        )
      }
      next()
    })
  },
  async (req, res) => {
    const ctx = ctxOf(req)
    if (!req.file) throw new AppError(400, 'attachments.fileRequired')
    const fields = uploadAttachmentFields.parse(req.body ?? {})
    const { attachment, created } = await service.upload(ctx, fields, req.file)
    res.status(created ? 201 : 200).json(attachment)
  },
)

attachmentsRouter.get('/attachments/:id', async (req, res) => {
  res.json(await service.get(ctxOf(req), parseId(req)))
})

/**
 * `/files/:id?v=&exp=&sig=` - signed URL download, mounted OUTSIDE /api (no cookie, no CSRF
 * header): the signature is the authorisation, so `<img src>` works in the office and in the
 * technician app. The tenant is taken from the row and checked against the signature.
 */
export const filesRouter = Router()

filesRouter.get('/:id', async (req, res) => {
  const id = parseId(req)
  // A missing or malformed signature is indistinguishable from a missing file (no shape leak).
  const parsed = fileQuery.safeParse(req.query ?? {})
  if (!parsed.success) throw new AppError(404, 'error.notFound')
  const q = parsed.data
  const row = await service.findOwner(id)
  if (!row || !verifyFileSignature(id, q.v, q.exp, row.tenantId, q.sig)) {
    throw new AppError(404, 'error.notFound')
  }
  const file = await service.readFile(row.tenantId, id, q.v)
  if (!file) throw new AppError(404, 'error.notFound')
  res.setHeader('Content-Type', file.mime)
  res.setHeader('Cache-Control', 'private, max-age=900')
  res.setHeader(
    'Content-Disposition',
    `inline; filename="${id}${q.v === 'thumb' ? '.thumb' : ''}.jpg"`,
  )
  res.send(file.bytes)
})
