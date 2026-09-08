/**
 * documents (L2) - attachments (photos), the visit <-> attachment link, signed file URLs.
 * Owns: attachment, visit_attachment. Files live behind the FileStorage port (platform/ports).
 * Public interface: upload (idempotent on the client id), get, readFile, linkToVisit,
 * attachmentsForVisits, processImage (seeds); routers.
 */
export { attachmentsRouter, filesRouter } from './http/router.js'
export {
  upload,
  get,
  readFile,
  findOwner,
  linkToVisit,
  attachmentsForVisits,
  toAttachmentDto,
  processImage,
  sha256Of,
  storageKeyFor,
} from './service.js'
export const moduleInfo = { name: 'documents', layer: 2, status: 'active' } as const
