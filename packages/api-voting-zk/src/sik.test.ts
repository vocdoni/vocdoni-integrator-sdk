import { describe, expect, it } from 'vitest'
import { calcSik, calcNullifier, calcVoteId } from './sik'

// Reference values generated with the original circomlibjs-based
// implementation for the same inputs — pins the @noble/curves poseidon swap
// to circomlib's consensus-critical output.
const ADDRESS = '0x1234567890123456789012345678901234567890'
const PERSONAL_SIGN = '0x' + 'ab'.repeat(65)
const PASSWORD = 'testpass'
const ELECTION_ID = '0x' + '11'.repeat(32)

describe('sik (noble/curves poseidon vs circomlibjs reference vectors)', () => {
  it('calcSik matches the circomlibjs reference', async () => {
    const sik = await calcSik(ADDRESS, PERSONAL_SIGN, PASSWORD)
    expect(sik).toBe('9202d7c2e3df5a9735a8262334fadf5c0c463e05235c38805ac59038cca9bf20')
  })

  it('calcNullifier matches the circomlibjs reference', async () => {
    const nullifier = await calcNullifier(PERSONAL_SIGN, PASSWORD, ELECTION_ID)
    expect(nullifier.toString()).toBe(
      '10882087501032857743826497573406119211598873977728017716185553761485625174216',
    )
  })

  it('calcVoteId matches the circomlibjs reference', async () => {
    const voteId = await calcVoteId(PERSONAL_SIGN, PASSWORD, ELECTION_ID)
    expect(voteId).toBe('180f0b12e957eca48638af325777bf35e3b45de82f3be6711b30b85570bf28c8')
  })
})
