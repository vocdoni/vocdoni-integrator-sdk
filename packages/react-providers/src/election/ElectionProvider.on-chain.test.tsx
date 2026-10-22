import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { strip0x, voteNullifier } from '@vocdoni/api-voting'
import { beforeEach, describe, expect, it } from 'vitest'
import { MOCK_CSP_SIGNATURE, MOCK_WEIGHT_HEX, mockProcess } from '../../../../mocks/handlers'
import { server } from '../../../../mocks/server'
import { TestProvider } from '../test-utils'
import { ElectionProvider, PartialVoteError, UnconfirmedVoteError, useElection } from './ElectionProvider'
import { listPendingVotes, savePendingVote } from './pending-votes'

// Verified vote status: a question counts as voted only on on-chain evidence,
// and a signed tx that did not land is re-sent from this tab's store.

const UPSTREAM_A = 'aa'.repeat(32)
const UPSTREAM_B = 'bb'.repeat(32)
/** sha256('{"memberNumber":"5"}') — the owner of the voter `connect()` identifies. */
const OWNER = '8167d5dc4919186f999eb3dd105c40ebf7f29ff46ba329a0232a7fbcdabd1549'

type Q = { questionId: string; upstreamId: string; canVote: boolean; hasVoted: boolean; hasSigned?: boolean }

/** Two-question process, plain or anonymous census. */
function useTwoQuestions(anonymous = false) {
  server.use(
    http.get('http://localhost/processes/:id', ({ params }) =>
      HttpResponse.json({
        ...mockProcess,
        id: params.id as string,
        census: { ...mockProcess.census, anonymous },
        questions: [
          { ...mockProcess.questions[0], id: 'q-0', upstreamId: UPSTREAM_A },
          { ...mockProcess.questions[0], id: 'q-1', upstreamId: UPSTREAM_B },
        ],
      }),
    ),
  )
}

/** Answers /check with whatever `questions()` returns at call time; `fail()` → 500. */
function mockCheck(questions: () => Q[], fail: () => boolean = () => false) {
  const calls = { count: 0 }
  server.use(
    http.post('http://localhost/processes/:processId/check', () => {
      calls.count++
      if (fail()) return HttpResponse.json({ error: 'chain unreachable' }, { status: 500 })
      return HttpResponse.json({ belongsToProcess: true, weight: MOCK_WEIGHT_HEX, questions: questions() })
    }),
  )
  return calls
}

const q = (questionId: string, upstreamId: string, over: Partial<Q> = {}): Q => ({
  questionId,
  upstreamId,
  canVote: true,
  hasVoted: false,
  hasSigned: false,
  ...over,
})

/**
 * Records the batch-signed ballots and the relayed batches, and counts CSP
 * consumptions (plain sign-batch or the anonymous flow's round 1). The relay
 * job answers `job(batch)`.
 */
function mockSignAndRelay(job: (txs: string[]) => object | 'pending' = () => ({})) {
  const signed: Array<{ upstreamId: string; address: string }> = []
  const batches: string[][] = []
  const signCalls = { count: 0 }
  server.use(
    // Counted, then falls through to the default (real blind signer) handler.
    http.post('http://localhost/processes/:processId/blind-point', () => {
      signCalls.count++
    }),
    http.post('http://localhost/processes/:processId/sign-batch', async ({ request }) => {
      signCalls.count++
      const body = (await request.json()) as { ballots: Array<{ upstreamId: string; address: string }> }
      signed.push(...body.ballots)
      return HttpResponse.json({
        signatures: body.ballots.map((b) => ({ upstreamId: b.upstreamId, signature: MOCK_CSP_SIGNATURE, weight: MOCK_WEIGHT_HEX })),
      })
    }),
    http.post('http://localhost/votes', async ({ request }) => {
      const body = (await request.json()) as { votes: Array<{ txPayload: string }> }
      batches.push(body.votes.map((v) => v.txPayload))
      return HttpResponse.json({ jobId: `job-${batches.length - 1}` }, { status: 202 })
    }),
    http.get('http://localhost/jobs/:jobId', ({ params }) => {
      const batch = batches[Number(String(params.jobId).slice(4))]
      const res = job(batch)
      if (res === 'pending') return HttpResponse.json({ jobId: params.jobId, status: 'pending', type: 'relay_votes' })
      return HttpResponse.json({ jobId: params.jobId, type: 'relay_votes', ...res })
    }),
  )
  return { signed, batches, signCalls }
}

/** A relay_votes job body whose per-envelope outcomes are `statuses`. */
const jobOf = (statuses: Array<'completed' | 'failed'>) => ({
  status: statuses.every((s) => s === 'completed') ? 'completed' : 'failed',
  result: {
    votes: statuses.map((st, i) =>
      st === 'completed'
        ? { processId: 'p', nullifier: `n-${i}`, status: st, voteID: `vote-${i}` }
        : { processId: 'p', nullifier: `n-${i}`, status: st, error: 'could not submit signed tx: API error: 502 ()' },
    ),
  },
})

function mockVerify(verified: () => string[], fail: () => boolean = () => false) {
  const calls: string[][] = []
  server.use(
    http.post('http://localhost/votes/verify', async ({ request }) => {
      const { nullifiers } = (await request.json()) as { nullifiers: string[] }
      calls.push(nullifiers)
      if (fail()) return HttpResponse.json({ error: 'blockchain request failed' }, { status: 500 })
      const ok = verified().map((n) => strip0x(n).toLowerCase())
      return HttpResponse.json({
        votes: nullifiers.map((n) => ({ nullifier: strip0x(n).toLowerCase(), verified: ok.includes(strip0x(n).toLowerCase()) })),
      })
    }),
  )
  return calls
}

function mockSignInfo(consumed: () => Array<{ questionId: string; nullifier: string }>) {
  server.use(
    http.post('http://localhost/processes/:processId/sign-info', () =>
      HttpResponse.json({ consumed: consumed().map((c) => ({ ...c, upstreamId: '', at: '2026-01-01T00:00:00Z' })) }),
    ),
  )
}

const nullifierOf = ({ upstreamId, address }: { upstreamId: string; address: string }) =>
  voteNullifier(address, upstreamId)

/** The current voter's stored nullifier for `upstreamId` (an anonymous census hides the signed address). */
const ownNullifier = (upstreamId: string) => listPendingVotes(upstreamId).find((e) => e.owner === OWNER)?.nullifier

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <TestProvider>
      <ElectionProvider id={mockProcess.id} voteOptions={{ jobTimeoutMs: 300, reconcile: { attempts: 3, intervalMs: 20 } }}>
        {children}
      </ElectionProvider>
    </TestProvider>
  )
}

const useVoter = () => useElection()

async function connect(result: { current: ReturnType<typeof useVoter> }) {
  await waitFor(() => expect(result.current.election).not.toBeNull())
  await act(async () => {
    await result.current.auth0({ memberNumber: '5' })
  })
  await act(async () => {
    await result.current.auth1(['123456'])
  })
  await waitFor(() => expect(result.current.isInCensus).toBe(true))
}

beforeEach(() => sessionStorage.clear())

describe('ElectionProvider — verified vote status', () => {
  it('AC1+AC2: a job-failed envelope that only the CSP signed ends failed, then the next vote() re-sends its stored tx', async () => {
    useTwoQuestions()
    let relayed = 0
    let q1OnChain = false
    mockCheck(() => [
      q('q-0', UPSTREAM_A, { hasSigned: relayed > 0, hasVoted: relayed > 0 }),
      q('q-1', UPSTREAM_B, { hasSigned: relayed > 0, hasVoted: q1OnChain }),
    ])
    const { signed, batches, signCalls } = mockSignAndRelay((txs) => {
      relayed++
      // First batch: the proxy 502s envelope 1. Second batch (the re-send) lands.
      if (batches.length === 1) return jobOf(['completed', 'failed'])
      q1OnChain = true
      return jobOf(txs.map(() => 'completed'))
    })
    mockSignInfo(() => (relayed > 0 ? signed.map((b, i) => ({ questionId: `q-${i}`, nullifier: strip0x(nullifierOf(b)) })) : []))

    const { result } = renderHook(useVoter, { wrapper })
    await connect(result)
    await waitFor(() => expect(result.current.isAbleToVote).toBe(true))

    let thrown: unknown
    await act(async () => {
      thrown = await result.current.vote([[0], [1]]).catch((e) => e)
    })
    expect(thrown).toBeInstanceOf(PartialVoteError)
    expect((thrown as PartialVoteError).failed.map((f) => f.questionId)).toEqual(['q-1'])
    expect(result.current.voteStatus).toEqual({ 'q-0': 'confirmed', 'q-1': 'failed' })
    expect(result.current.hasVoted).toBe(false)
    expect(result.current.pendingVotes).toEqual({ 'q-1': true })
    expect(result.current.isAbleToVote).toBe(true)
    const [stored] = listPendingVotes(UPSTREAM_B)
    expect(stored).toMatchObject({ owner: OWNER, txPayload: batches[0][1] })
    // The entry is keyed by the Go nullifier of the signed ephemeral address.
    expect(stored.nullifier).toBe(nullifierOf(signed[1]))
    expect(listPendingVotes(UPSTREAM_A)).toEqual([])

    // Retry: q-1 re-sends its stored tx — no new CSP signature, its ballot ignored.
    await act(async () => {
      await result.current.vote([[0], [0]])
    })
    expect(signCalls.count).toBe(1)
    expect(batches[1]).toEqual([batches[0][1]])
    expect(result.current.voteStatus).toEqual({ 'q-0': 'confirmed', 'q-1': 'confirmed' })
    expect(result.current.hasVoted).toBe(true)
    expect(result.current.pendingVotes).toEqual({})
    expect(listPendingVotes(UPSTREAM_B)).toEqual([])
  })

  it('AC3: signed, not on chain, nothing stored → unconfirmed; no sign, no relay; vote() throws UnconfirmedVoteError', async () => {
    mockCheck(() => [q('q-0', mockProcess.questions[0].upstreamId, { hasSigned: true })])
    mockSignInfo(() => [{ questionId: 'q-0', nullifier: '99'.repeat(32) }])
    const { batches, signCalls } = mockSignAndRelay()

    const { result } = renderHook(useVoter, { wrapper })
    await connect(result)
    await waitFor(() => expect(result.current.voteStatus).toEqual({ 'q-0': 'unconfirmed' }))
    expect(result.current.isAbleToVote).toBe(false)
    expect(result.current.hasVoted).toBe(false)

    const err = await result.current.vote([[0]]).catch((e) => e)
    expect(err).toBeInstanceOf(UnconfirmedVoteError)
    expect(err.questions).toEqual([{ questionId: 'q-0', status: 'unconfirmed' }])
    expect(signCalls.count).toBe(0)
    expect(batches).toHaveLength(0)
  })

  it('AC4: a lost relay response is confirmed only on on-chain evidence', async () => {
    let relayReached = false
    mockCheck(() => [q('q-0', mockProcess.questions[0].upstreamId, { hasSigned: relayReached, hasVoted: relayReached })])
    const { signed } = mockSignAndRelay()
    server.use(
      http.post('http://localhost/votes', () => {
        relayReached = true
        return HttpResponse.error()
      }),
    )
    mockSignInfo(() => (relayReached ? [{ questionId: 'q-0', nullifier: strip0x(nullifierOf(signed[0])) }] : []))

    const { result } = renderHook(useVoter, { wrapper })
    await connect(result)
    let voteId = ''
    await act(async () => {
      voteId = await result.current.vote([[0]])
    })
    expect(voteId).toBe(strip0x(nullifierOf(signed[0])))
    expect(result.current.voteStatus).toEqual({ 'q-0': 'confirmed' })
    expect(result.current.hasVoted).toBe(true)
  })

  it('AC4: a verification error after a failed envelope → failed / could not confirm, entry kept', async () => {
    let relayed = false
    mockCheck(
      () => [q('q-0', mockProcess.questions[0].upstreamId)],
      () => relayed,
    )
    mockSignAndRelay(() => {
      relayed = true
      return jobOf(['failed'])
    })

    const { result } = renderHook(useVoter, { wrapper })
    await connect(result)
    let thrown: unknown
    await act(async () => {
      thrown = await result.current.vote([[0]]).catch((e) => e)
    })
    expect(thrown).toBeInstanceOf(PartialVoteError)
    expect(((thrown as PartialVoteError).failed[0].error as Error).message).toBe('could not confirm the vote on chain yet')
    expect(result.current.voteStatus).toEqual({ 'q-0': 'failed' })
    expect(result.current.hasVoted).toBe(false)
    expect(listPendingVotes(mockProcess.questions[0].upstreamId)).toHaveLength(1)
  })

  it('AC4: a job wait that times out is confirmed only once the chain shows the vote', async () => {
    let polls = 0
    mockCheck(() => {
      polls++
      // Mount + pre-flight see nothing; the vote shows up on the 2nd reconcile poll.
      const onChain = polls >= 4
      return [q('q-0', mockProcess.questions[0].upstreamId, { hasSigned: polls >= 3, hasVoted: onChain })]
    })
    const { signed } = mockSignAndRelay(() => 'pending')

    const { result } = renderHook(useVoter, { wrapper })
    await connect(result)
    let voteId = ''
    await act(async () => {
      voteId = await result.current.vote([[0]])
    })
    expect(voteId).toBe(strip0x(nullifierOf(signed[0])))
    expect(result.current.hasVoted).toBe(true)
  })

  it('AC5: anonymous census — on chain is decided by /votes/verify on the stored nullifier, never by hasSigned', async () => {
    useTwoQuestions(true)
    let relayed = false
    mockCheck(() => [
      q('q-0', UPSTREAM_A, { hasSigned: relayed }),
      q('q-1', UPSTREAM_B, { hasSigned: relayed }),
    ])
    mockSignAndRelay(() => {
      relayed = true
      return jobOf(['failed', 'failed'])
    })
    // Only q-0's nullifier is on chain.
    const verifyCalls = mockVerify(() => [ownNullifier(UPSTREAM_A)!])

    const { result } = renderHook(useVoter, { wrapper })
    await connect(result)
    let thrown: unknown
    await act(async () => {
      thrown = await result.current.vote([[0], [1]]).catch((e) => e)
    })
    const [nA, nB] = [ownNullifier(UPSTREAM_A)!, ownNullifier(UPSTREAM_B)!]
    expect(thrown).toBeInstanceOf(PartialVoteError)
    expect((thrown as PartialVoteError).succeeded).toEqual([{ questionId: 'q-0', voteId: strip0x(nA) }])
    expect((thrown as PartialVoteError).failed.map((f) => f.questionId)).toEqual(['q-1'])
    expect(verifyCalls).toEqual([[nA, nB]])
    expect(result.current.voteStatus).toEqual({ 'q-0': 'confirmed', 'q-1': 'failed' })
    // Confirmed anonymous entry: the nullifier stays, the tx is dropped.
    const [a] = listPendingVotes(UPSTREAM_A)
    expect(a).toMatchObject({ owner: OWNER, nullifier: nA })
    expect(a.txPayload).toBeUndefined()
    expect(a.confirmedAt).toEqual(expect.any(Number))
    expect(listPendingVotes(UPSTREAM_B)[0].txPayload).toEqual(expect.any(String))
    expect(result.current.pendingVotes).toEqual({ 'q-1': true })
  })

  it('AC8: old backend (no hasSigned), anonymous census — hasVoted is trusted as today and /votes/verify is never called', async () => {
    useTwoQuestions(true)
    let relayed = false
    mockCheck(() => [
      { questionId: 'q-0', upstreamId: UPSTREAM_A, canVote: true, hasVoted: relayed },
      { questionId: 'q-1', upstreamId: UPSTREAM_B, canVote: true, hasVoted: relayed },
    ])
    mockSignAndRelay(() => {
      relayed = true
      return jobOf(['completed', 'failed'])
    })
    const verifyCalls = mockVerify(() => [])

    const { result } = renderHook(useVoter, { wrapper })
    await connect(result)
    await act(async () => {
      await result.current.vote([[0], [1]])
    })
    expect(result.current.voteStatus).toEqual({ 'q-0': 'confirmed', 'q-1': 'confirmed' })
    expect(result.current.hasVoted).toBe(true)
    expect(verifyCalls).toHaveLength(0)
  })

  it.each([
    ['plain', false],
    ['anonymous', true],
  ])('AC11 (%s census): another voter’s entry in this tab is not relayed, verified or deleted', async (_name, anonymous) => {
    useTwoQuestions(anonymous)
    const theirs = { owner: 'someone-else', nullifier: '0x' + '77'.repeat(32), txPayload: 'deadbeef', savedAt: 1 }
    savePendingVote(UPSTREAM_A, theirs)
    let relayed = false
    mockCheck(() => [
      q('q-0', UPSTREAM_A, { hasSigned: relayed, hasVoted: relayed && !anonymous }),
      q('q-1', UPSTREAM_B, { hasSigned: relayed, hasVoted: relayed && !anonymous }),
    ])
    const { signCalls, batches } = mockSignAndRelay(() => {
      relayed = true
      return jobOf(['completed', 'completed'])
    })
    const verifyCalls = mockVerify(() => [])

    const { result } = renderHook(useVoter, { wrapper })
    await connect(result)
    await act(async () => {
      await result.current.vote([[0], [1]])
    })
    expect(signCalls.count).toBe(1)
    expect(batches).toHaveLength(1)
    expect(batches[0]).toHaveLength(2)
    expect(batches[0]).not.toContain('deadbeef')
    expect(verifyCalls).toHaveLength(0)
    expect(result.current.hasVoted).toBe(true)
    expect(listPendingVotes(UPSTREAM_A)).toContainEqual(theirs)
  })

  it('AC12: a check() failure inside vote() throws "could not verify" without signing or relaying', async () => {
    let down = false
    mockCheck(() => [q('q-0', mockProcess.questions[0].upstreamId)], () => down)
    const { signCalls, batches } = mockSignAndRelay()

    const { result } = renderHook(useVoter, { wrapper })
    await connect(result)
    await waitFor(() => expect(result.current.isAbleToVote).toBe(true))
    down = true
    await expect(result.current.vote([[0]])).rejects.toThrow('Could not verify your voting status; try again')
    expect(signCalls.count).toBe(0)
    expect(batches).toHaveLength(0)
  })

  it('a batch the backend refuses leaves every stored tx pending, so the form locks those questions', async () => {
    mockCheck(() => [q('q-0', mockProcess.questions[0].upstreamId)])
    mockSignAndRelay()
    server.use(http.post('http://localhost/votes', () => HttpResponse.json({ error: 'invalid vote' }, { status: 400 })))

    const { result } = renderHook(useVoter, { wrapper })
    await connect(result)
    let thrown: unknown
    await act(async () => {
      thrown = await result.current.vote([[0]]).catch((e) => e)
    })
    expect(thrown).toBeInstanceOf(Error)
    expect(thrown).not.toBeInstanceOf(PartialVoteError)
    expect(result.current.voteStatus).toEqual({ 'q-0': 'failed' })
    expect(result.current.pendingVotes).toEqual({ 'q-0': true })
    expect(listPendingVotes(mockProcess.questions[0].upstreamId)).toHaveLength(1)
  })

  it('clearVoter clears the vote state but keeps the tab’s stored txs', async () => {
    const upstreamId = mockProcess.questions[0].upstreamId
    let relayed = false
    mockCheck(() => [q('q-0', upstreamId, { hasSigned: relayed })])
    mockSignAndRelay(() => {
      relayed = true
      return jobOf(['failed'])
    })

    const { result } = renderHook(useVoter, { wrapper })
    await connect(result)
    await act(async () => {
      await result.current.vote([[0]]).catch(() => {})
    })
    expect(result.current.pendingVotes).toEqual({ 'q-0': true })

    act(() => result.current.clearVoter())
    expect(result.current.pendingVotes).toEqual({})
    expect(listPendingVotes(upstreamId)).toHaveLength(1)
    expect(listPendingVotes(upstreamId)[0]).toMatchObject({ owner: OWNER, txPayload: expect.any(String) })
  })

  it('a signBatch throw keeps the pending stored tx for the next call', async () => {
    useTwoQuestions()
    let relayed = 0
    mockCheck(() => [
      q('q-0', UPSTREAM_A, { hasVoted: relayed > 1, hasSigned: relayed > 1 }),
      q('q-1', UPSTREAM_B, { hasVoted: relayed > 1, hasSigned: relayed > 0 }),
    ])
    const { batches } = mockSignAndRelay((txs) => {
      relayed++
      return relayed === 1 ? jobOf(['failed']) : jobOf(txs.map(() => 'completed'))
    })
    // First call: the CSP refuses q-0 and signs q-1. Second: sign-batch is down. Third: signs everything.
    const signed: Array<{ upstreamId: string; address: string }> = []
    let signRound = 0
    server.use(
      http.post('http://localhost/processes/:processId/sign-batch', async ({ request }) => {
        signRound++
        if (signRound === 2) return HttpResponse.json({ error: 'csp down' }, { status: 500 })
        const body = (await request.json()) as { ballots: Array<{ upstreamId: string; address: string }> }
        signed.push(...body.ballots)
        return HttpResponse.json({
          signatures: body.ballots.map((b) =>
            signRound === 1 && b.upstreamId === UPSTREAM_A
              ? { upstreamId: b.upstreamId, error: 'refused' }
              : { upstreamId: b.upstreamId, signature: MOCK_CSP_SIGNATURE, weight: MOCK_WEIGHT_HEX },
          ),
        })
      }),
    )
    mockSignInfo(() =>
      signed.filter((b) => b.upstreamId === UPSTREAM_B).map((b) => ({ questionId: 'q-1', nullifier: strip0x(nullifierOf(b)) })),
    )

    const { result } = renderHook(useVoter, { wrapper })
    await connect(result)
    await act(async () => {
      await result.current.vote([[0], [1]]).catch(() => {})
    })
    expect(batches).toHaveLength(1)
    const storedTx = batches[0][0]
    expect(result.current.pendingVotes).toEqual({ 'q-1': true })

    let thrown: unknown
    await act(async () => {
      thrown = await result.current.vote([[0], [1]]).catch((e) => e)
    })
    expect(thrown).toBeInstanceOf(Error)
    expect(batches).toHaveLength(1)
    expect(listPendingVotes(UPSTREAM_B)).toEqual([expect.objectContaining({ owner: OWNER, txPayload: storedTx })])

    // The next call re-sends the stored tx alongside the freshly signed q-0.
    await act(async () => {
      await result.current.vote([[0], [1]])
    })
    expect(batches[1]).toHaveLength(2)
    expect(batches[1][1]).toBe(storedTx)
    expect(result.current.hasVoted).toBe(true)
  })
})
