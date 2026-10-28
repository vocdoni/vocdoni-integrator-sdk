import { describe, expect, it } from 'vitest'
import { voteNullifier } from './nullifier'

// Generated with Go go.vocdoni.io/dvote@v1.10.2-0.20260901150211-33a981e44494
// state.GenerateNullifier(common.HexToAddress(address), hex.DecodeString(electionId)).
const VECTOR = {
  address: '0x5daf30eb2441ac8c2e52af402a385f37a888274a',
  electionId: '6be21a5a9dc0400a7e20f2d70b39535fe9538ecf05945ad549a1030400000001',
  nullifier: '0x71b6c5b4b7a7cd61350627097d648749cb8cd2e07fed9cba4dbfd4ad82a77caa',
}

describe('voteNullifier', () => {
  it('matches Go state.GenerateNullifier', () => {
    expect(voteNullifier(VECTOR.address, VECTOR.electionId)).toBe(VECTOR.nullifier)
  })

  it('accepts bare or 0x-prefixed hex in any case', () => {
    expect(voteNullifier(VECTOR.address.slice(2).toUpperCase(), `0x${VECTOR.electionId.toUpperCase()}`)).toBe(
      VECTOR.nullifier,
    )
  })

  it('refuses an address that is not 20 bytes', () => {
    expect(() => voteNullifier('0x1234', VECTOR.electionId)).toThrow('20 bytes')
  })
})
