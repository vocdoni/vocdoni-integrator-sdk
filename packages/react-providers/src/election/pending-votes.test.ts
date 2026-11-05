import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearPendingVotes,
  listPendingVotes,
  removePendingVote,
  savePendingVote,
  type PendingVote,
} from './pending-votes'

const E1 = 'aa'.repeat(32)
const E2 = 'bb'.repeat(32)
const entry = (over: Partial<PendingVote> = {}): PendingVote => ({
  owner: 'owner-a',
  nullifier: '0x' + '11'.repeat(32),
  txPayload: 'cafe',
  savedAt: 1,
  ...over,
})

beforeEach(() => sessionStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('pending-votes store', () => {
  it('saves under vocdoni.pendingVote.<electionId>.<nullifier> in sessionStorage and lists it back', () => {
    savePendingVote(`0x${E1.toUpperCase()}`, entry())
    expect(sessionStorage.getItem(`vocdoni.pendingVote.${E1}.${'11'.repeat(32)}`)).not.toBeNull()
    expect(localStorage.length).toBe(0)
    expect(listPendingVotes(E1)).toEqual([entry()])
  })

  it('lists only the entries of the given election, whoever owns them', () => {
    savePendingVote(E1, entry())
    savePendingVote(E1, entry({ owner: 'owner-b', nullifier: '22'.repeat(32) }))
    savePendingVote(E2, entry({ nullifier: '33'.repeat(32) }))
    expect(listPendingVotes(E1).map((e) => e.owner).sort()).toEqual(['owner-a', 'owner-b'])
    expect(listPendingVotes(E2)).toHaveLength(1)
  })

  it('replaces an entry saved again for the same nullifier (confirmation drops txPayload)', () => {
    savePendingVote(E1, entry())
    savePendingVote(E1, entry({ txPayload: undefined, confirmedAt: 2 }))
    expect(listPendingVotes(E1)).toEqual([{ owner: 'owner-a', nullifier: entry().nullifier, savedAt: 1, confirmedAt: 2 }])
  })

  it('removes one entry, matching the nullifier with or without 0x', () => {
    savePendingVote(E1, entry())
    removePendingVote(E1, '11'.repeat(32))
    expect(listPendingVotes(E1)).toEqual([])
  })

  it('clears every entry of an election and leaves the others', () => {
    savePendingVote(E1, entry())
    savePendingVote(E1, entry({ nullifier: '22'.repeat(32) }))
    savePendingVote(E2, entry())
    clearPendingVotes(E1)
    expect(listPendingVotes(E1)).toEqual([])
    expect(listPendingVotes(E2)).toHaveLength(1)
  })

  it('skips malformed entries', () => {
    sessionStorage.setItem(`vocdoni.pendingVote.${E1}.bad`, '{not json')
    sessionStorage.setItem(`vocdoni.pendingVote.${E1}.shape`, '{"foo":1}')
    savePendingVote(E1, entry())
    expect(listPendingVotes(E1)).toEqual([entry()])
  })

  it('swallows storage errors', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(() => savePendingVote(E1, entry())).not.toThrow()
    expect(listPendingVotes(E1)).toEqual([])
  })
})
