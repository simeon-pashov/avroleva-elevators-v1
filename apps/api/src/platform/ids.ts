import { v7 as uuidv7 } from 'uuid'
import { randomBytes } from 'node:crypto'

/** UUIDv7: time-sortable, so `ORDER BY id` equals creation order (ARCHITECTURE section 3). */
export const newId = (): string => uuidv7()

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O/1/I

/** Public-page token (`/p/:token`): 128 random bits as 32 hex chars; globally unique, rotatable. */
export function newPublicToken(): string {
  return randomBytes(16).toString('hex')
}

/** 8-char public code for QR labels (step 2+); unique per tenant. */
export function newPublicCode(): string {
  const bytes = randomBytes(8)
  let out = ''
  for (let i = 0; i < 8; i++) out += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length]
  return out
}
