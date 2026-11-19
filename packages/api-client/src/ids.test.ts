import { describe, expect, it } from 'vitest'
import { isOrganizationAddress, isProcessId, isVochainElectionId, normalizeOrganizationAddress } from './ids'

describe('isProcessId', () => {
  it('accepts a 24-hex Mongo ObjectID in either case', () => {
    expect(isProcessId('66a1b2c3d4e5f60718293a4b')).toBe(true)
    expect(isProcessId('66A1B2C3D4E5F60718293A4B')).toBe(true)
  })

  it('rejects a 0x prefix, wrong length and non-hex', () => {
    expect(isProcessId('0x66a1b2c3d4e5f60718293a4b')).toBe(false)
    expect(isProcessId('66a1b2c3d4e5f60718293a4')).toBe(false)
    expect(isProcessId('66a1b2c3d4e5f60718293a4bf')).toBe(false)
    expect(isProcessId('66a1b2c3d4e5f60718293a4z')).toBe(false)
  })

  it('rejects non-strings', () => {
    expect(isProcessId(undefined)).toBe(false)
    expect(isProcessId(null)).toBe(false)
    expect(isProcessId(123)).toBe(false)
  })
})

describe('isVochainElectionId', () => {
  const hex = 'a'.repeat(64)

  it('accepts 64 hex with or without 0x', () => {
    expect(isVochainElectionId(hex)).toBe(true)
    expect(isVochainElectionId(`0x${hex}`)).toBe(true)
    expect(isVochainElectionId(`0X${'F'.repeat(64)}`)).toBe(true)
  })

  it('rejects other lengths and non-hex', () => {
    expect(isVochainElectionId('a'.repeat(63))).toBe(false)
    expect(isVochainElectionId('a'.repeat(65))).toBe(false)
    expect(isVochainElectionId(`${'g'.repeat(64)}`)).toBe(false)
  })

  it('rejects non-strings', () => {
    expect(isVochainElectionId(undefined)).toBe(false)
    expect(isVochainElectionId(null)).toBe(false)
  })
})

describe('isOrganizationAddress', () => {
  const hex = '1a9ffe1f4c2493578ce4a7dbebd7d95433eee6f0'

  it('accepts 40 hex with or without 0x, in either case', () => {
    expect(isOrganizationAddress(hex)).toBe(true)
    expect(isOrganizationAddress(`0x${hex}`)).toBe(true)
    expect(isOrganizationAddress(`0x${hex.toUpperCase()}`)).toBe(true)
  })

  it('rejects other lengths and non-hex', () => {
    expect(isOrganizationAddress(hex.slice(1))).toBe(false)
    expect(isOrganizationAddress(`${hex}00`)).toBe(false)
    expect(isOrganizationAddress(`0x${'z'.repeat(40)}`)).toBe(false)
  })

  it('rejects non-strings', () => {
    expect(isOrganizationAddress(undefined)).toBe(false)
    expect(isOrganizationAddress(12)).toBe(false)
  })
})

describe('normalizeOrganizationAddress', () => {
  it('adds the 0x prefix and lowercases', () => {
    expect(normalizeOrganizationAddress('1A9FFE1F4C2493578CE4A7DBEBD7D95433EEE6F0')).toBe(
      '0x1a9ffe1f4c2493578ce4a7dbebd7d95433eee6f0',
    )
  })

  it('strips a 0x or 0X prefix before normalizing', () => {
    expect(normalizeOrganizationAddress('0xABCDEF')).toBe('0xabcdef')
    expect(normalizeOrganizationAddress('0XABCDEF')).toBe('0xabcdef')
  })

  it('is idempotent', () => {
    const once = normalizeOrganizationAddress('0XABCDEF')
    expect(normalizeOrganizationAddress(once)).toBe(once)
  })
})
