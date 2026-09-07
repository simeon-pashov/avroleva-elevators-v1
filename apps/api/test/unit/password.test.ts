import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from '../../src/modules/tenancy/domain/password.js'

describe('passwords', () => {
  it('hashes with bcrypt cost 12 and verifies', async () => {
    const hash = await hashPassword('correct horse')
    expect(hash).toMatch(/^\$2[aby]\$12\$/)
    expect(await verifyPassword('correct horse', hash)).toBe(true)
    expect(await verifyPassword('wrong', hash)).toBe(false)
  }, 20_000)

  it('refuses passwords under 8 characters', async () => {
    await expect(hashPassword('short')).rejects.toThrow()
  })
})
