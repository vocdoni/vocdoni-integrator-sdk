import { describe, expect, it } from 'vitest'
import { hashMemberPassword } from './member-password'

const ORG = '0x00000000000000000000000000000000000000AA'
const VECTOR = '2f7e83a0b19a82fa9a5dc6ecc6ff44ec82679ea87012a7187bd3313366bf277e'

describe('hashMemberPassword', () => {
  it('matches the reference test vector', async () => {
    expect(await hashMemberPassword(ORG, 's3cret')).toBe(VECTOR)
  })

  it('ignores the case and the 0x prefix of the organization address', async () => {
    expect(await hashMemberPassword('00000000000000000000000000000000000000aa', 's3cret')).toBe(VECTOR)
    expect(await hashMemberPassword('0X00000000000000000000000000000000000000AA', 's3cret')).toBe(VECTOR)
  })

  it('trims surrounding whitespace from the password', async () => {
    expect(await hashMemberPassword(ORG, '  s3cret\t\n')).toBe(VECTOR)
  })

  it('normalizes the password to NFC', async () => {
    const composed = 'café'
    const decomposed = 'café'
    expect(await hashMemberPassword(ORG, decomposed)).toBe(await hashMemberPassword(ORG, composed))
  })

  it('rejects an empty or whitespace-only password', async () => {
    await expect(hashMemberPassword(ORG, '')).rejects.toThrow('empty password')
    await expect(hashMemberPassword(ORG, '   ')).rejects.toThrow('empty password')
  })

  it.each([
    ['39 hex characters', '0x' + '0'.repeat(39)],
    ['a non-hex character', '0x' + '0'.repeat(39) + 'g'],
    ['an empty string', ''],
    ['a doubled 0x prefix', '0x0x' + '0'.repeat(40)],
  ])('rejects an address with %s', async (_, address) => {
    await expect(hashMemberPassword(address, 's3cret')).rejects.toThrow('not an organization address')
  })
})
