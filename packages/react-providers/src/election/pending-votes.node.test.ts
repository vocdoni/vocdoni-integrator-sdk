// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { clearPendingVotes, listPendingVotes, removePendingVote, savePendingVote } from './pending-votes'

describe('pending-votes store without a window (SSR)', () => {
  it('is a silent no-op', () => {
    expect(typeof window).toBe('undefined')
    const E = 'aa'.repeat(32)
    expect(() => savePendingVote(E, { owner: 'o', nullifier: '11', txPayload: 'cafe', savedAt: 1 })).not.toThrow()
    expect(listPendingVotes(E)).toEqual([])
    expect(() => removePendingVote(E, '11')).not.toThrow()
    expect(() => clearPendingVotes(E)).not.toThrow()
  })
})
