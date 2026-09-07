import bcrypt from 'bcryptjs'

export const BCRYPT_COST = 12
export const MIN_PASSWORD_LENGTH = 8

export async function hashPassword(plain: string): Promise<string> {
  if (plain.length < MIN_PASSWORD_LENGTH) throw new Error('password too short')
  return bcrypt.hash(plain, BCRYPT_COST)
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}

/** Constant-time-ish dummy compare so a missing user costs the same as a wrong password. */
const DUMMY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEeO5f0bJ7g8L4bKQYbF1a0QwQ0m4c9Xm5S'
export async function burnCompare(plain: string): Promise<void> {
  await bcrypt.compare(plain, DUMMY_HASH).catch(() => false)
}
