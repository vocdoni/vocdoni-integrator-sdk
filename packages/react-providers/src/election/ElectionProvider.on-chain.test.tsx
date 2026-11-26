import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { strip0x, voteNullifier } from '@vocdoni/api-voting'
import { beforeEach, describe, expect, it } from 'vitest'
import { MOCK_CSP_SIGNATURE, MOCK_WEIGHT_HEX, mockProcess } from '../../../../mocks/handlers'
import { server } from '../../../../mocks/server'
import { TestProvider } from '../test-utils'
import {
  ElectionProvider,
  NoEligibleQuestionError,
  NoOpenQuestionError,
  PartialVoteError,
  UnconfirmedVoteError,
  useElection,
} from './ElectionProvider'
import { listPendingVotes, savePendingVote } from './pending-votes'

// Verified vote status: a question counts as voted only on on-chain evidence,
// and a signed tx that did not land is re-sent from this tab's store.

const UPSTREAM_A = 'aa'.repeat(32)
const UPSTREAM_B = 'bb'.repeat(32)
/** sha256('{"memberNumber":"5"}') — the owner of the voter `connect()` identifies. */
const OWNER = '8167d5dc4919186f999eb3dd105c40ebf7f29ff46ba329a0232a7fbcdabd1549'

type Q = { questionId: string; upstreamId: string; canVote: boolean; hasVoted: boolean; hasSigned?: boolean }

/**
 * Two-question process, plain or anonymous census; `statuses` overrides each
 * question's wire status. `endDate` defaults to the mock's past date: a
 * `canVote: false` reads ineligible only while the process runs.
 */
function useTwoQuestions(anonymous = false, statuses: [string, string] = ['READY', 'READY'], endDate = mockProcess.endDate) {
  server.use(
    http.get('http://localhost/processes/:id', ({ params }) =>
      HttpResponse.json({
        ...mockProcess,
        id: params.id as string,
        endDate,
        census: { ...mockProcess.census, anonymous },
        questions: [
          { ...mockProcess.questions[0], id: 'q-0', upstreamId: UPSTREAM_A, status: statuses[0] },
          { ...mockProcess.questions[0], id: 'q-1', upstreamId: UPSTREAM_B, status: statuses[1] },
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
 * consumptions (plain sign-batch or the anonymous flow's round 1). `requested`
 * holds the upstream id of every question the CSP was asked to sign, in either
 * flow. The relay job answers `job(batch)`.
 */
function mockSignAndRelay(job: (txs: string[]) => object | 'pending' = () => ({})) {
  const signed: Array<{ upstreamId: string; address: string }> = []
  const requested: string[] = []
  const batches: string[][] = []
  const signCalls = { count: 0 }
  server.use(
    // Counted, then falls through to the default (real blind signer) handler.
    http.post('http://localhost/processes/:processId/blind-point', async ({ request }) => {
      signCalls.count++
      const body = (await request.clone().json()) as { electionIds: string[] }
      requested.push(...body.electionIds)
    }),
    // Round 2 of the anonymous flow: records what it blind-signs, then falls through.
    http.post('http://localhost/processes/:processId/blind-sign', async ({ request }) => {
      const body = (await request.clone().json()) as { ballots: Array<{ upstreamId: string }> }
      requested.push(...body.ballots.map((b) => b.upstreamId))
    }),
    http.post('http://localhost/processes/:processId/sign-batch', async ({ request }) => {
      signCalls.count++
      const body = (await request.json()) as { ballots: Array<{ upstreamId: string; address: string }> }
      requested.push(...body.ballots.map((b) => b.upstreamId))
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
  return { signed, requested, batches, signCalls }
}

/**
 * A relay_votes job body whose per-envelope outcomes are `statuses`. With
 * `nullifiers`, each entry carries that nullifier (and, completed, it as the
 * vote id, as Vochain does); otherwise placeholders.
 */
const jobOf = (statuses: Array<'completed' | 'failed'>, nullifiers?: string[]) => ({
  status: statuses.every((s) => s === 'completed') ? 'completed' : 'failed',
  result: {
    votes: statuses.map((st, i) => {
      const nullifier = nullifiers?.[i] ?? `n-${i}`
      return st === 'completed'
        ? { processId: 'p', nullifier, status: st, voteID: nullifiers ? nullifier : `vote-${i}` }
        : { processId: 'p', nullifier, status: st, error: 'could not submit signed tx: API error: 502 ()' }
    }),
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
    // The job reports each relayed envelope's real nullifier: the first batch
    // is in signing order, so a tx's index there names its signed ballot.
    const nullifiersOf = (txs: string[]) => txs.map((tx) => strip0x(nullifierOf(signed[batches[0].indexOf(tx)])))
    const { signed, batches, signCalls } = mockSignAndRelay((txs) => {
      relayed++
      // First batch: the proxy 502s envelope 1. Second batch (the re-send) lands.
      if (batches.length === 1) return jobOf(['completed', 'failed'], nullifiersOf(txs))
      q1OnChain = true
      return jobOf(
        txs.map(() => 'completed'),
        nullifiersOf(txs),
      )
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
    expect(result.current.voteIds['q-0']).toBe(strip0x(nullifierOf(signed[0])))
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
    // The backend's nullifier for the re-sent envelope is the one derived locally.
    expect(result.current.voteIds['q-1']).toBe(strip0x(nullifierOf(signed[1])))
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

  it('re-identifying as another voter (2-step) drops the previous token: no check or re-send on the mixed session', async () => {
    useTwoQuestions(true)
    // Each participant gets its own token, so a check() names whose session it ran on.
    server.use(
      http.post('http://localhost/processes/:processId/auth/0', async ({ request }) => {
        const { memberNumber } = (await request.json()) as { memberNumber: string }
        return HttpResponse.json({ authToken: `t-${memberNumber}` })
      }),
    )
    const checkTokens: string[] = []
    server.use(
      http.post('http://localhost/processes/:processId/check', async ({ request }) => {
        checkTokens.push(((await request.json()) as { authToken: string }).authToken)
        return HttpResponse.json({
          belongsToProcess: true,
          weight: MOCK_WEIGHT_HEX,
          questions: [q('q-0', UPSTREAM_A, { hasSigned: true }), q('q-1', UPSTREAM_B, { hasSigned: true })],
        })
      }),
    )
    // Voter B's tx, stored earlier in this tab. On A's check (anonymous: owner + hasSigned) it would read as B's own.
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('{"memberNumber":"6"}'))
    const ownerB = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
    const nullifierB = '0x' + '6b'.repeat(32)
    savePendingVote(UPSTREAM_A, { owner: ownerB, nullifier: nullifierB, txPayload: 'b-tx', savedAt: 1 })
    const { batches } = mockSignAndRelay((txs) => jobOf(txs.map(() => 'completed')))
    mockVerify(() => [])

    const { result } = renderHook(useVoter, { wrapper })
    await connect(result)
    expect(checkTokens.every((t) => t === 'confirmed-t-5')).toBe(true)
    checkTokens.length = 0

    await act(async () => {
      await result.current.auth0({ memberNumber: '6' })
    })
    await act(() => new Promise((r) => setTimeout(r, 50)))
    expect(result.current.connected).toBe(false)
    expect(result.current.isInCensus).toBe(false)
    expect(checkTokens).toEqual([])
    expect(batches).toEqual([])

    await act(async () => {
      await result.current.auth1(['123456'])
    })
    await waitFor(() => expect(result.current.voteStatus).toEqual({ 'q-0': 'confirmed', 'q-1': 'signed' }))
    expect(checkTokens.length).toBeGreaterThan(0)
    expect(checkTokens.every((t) => t === 'confirmed-t-6')).toBe(true)
    expect(batches).toEqual([['b-tx']])
    expect(result.current.pendingVotes).toEqual({})
  })

  it('AC12: a check() failure inside vote() throws "could not verify" without signing or relaying', async () => {
    let down = false
    mockCheck(() => [q('q-0', mockProcess.questions[0].upstreamId)], () => down)
    const { signCalls, batches } = mockSignAndRelay()

    const { result } = renderHook(useVoter, { wrapper })
    await connect(result)
    await waitFor(() => expect(result.current.isAbleToVote).toBe(true))
    down = true
    const err = await result.current.vote([[0]]).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toBe('Could not verify your voting status; try again')
    // The underlying check() failure is kept for the integrator to inspect.
    expect((err as Error).cause).toBeInstanceOf(Error)
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

// #111: the CSP refuses a whole batch if any question in it is not open.
describe('ElectionProvider — questions that are not open', () => {
  for (const anonymous of [false, true]) {
    it(`signs and relays only the open question (${anonymous ? 'anonymous' : 'plain'} census)`, async () => {
      useTwoQuestions(anonymous, ['READY', 'PAUSED'])
      mockCheck(() => [q('q-0', UPSTREAM_A), q('q-1', UPSTREAM_B)])
      const { signed, batches } = mockSignAndRelay((txs) => jobOf(txs.map(() => 'completed')))

      const { result } = renderHook(useVoter, { wrapper })
      await connect(result)
      await waitFor(() => expect(result.current.isAbleToVote).toBe(true))

      await act(async () => {
        await result.current.vote([[0], [1]])
      })
      if (!anonymous) expect(signed.map((b) => b.upstreamId)).toEqual([UPSTREAM_A])
      expect(batches).toEqual([[expect.any(String)]])
      expect(result.current.hasVoted).toBe(false)
      // The skipped question is not left at 'signing'.
      expect(result.current.voteStatus).toEqual({ 'q-0': 'confirmed' })
    })
  }

  it('throws NoOpenQuestionError and isAbleToVote is false when no unvoted question is open', async () => {
    useTwoQuestions(false, ['PAUSED', 'PAUSED'])
    mockCheck(() => [q('q-0', UPSTREAM_A), q('q-1', UPSTREAM_B)])
    const { batches, signCalls } = mockSignAndRelay()

    const { result } = renderHook(useVoter, { wrapper })
    await connect(result)
    expect(result.current.isAbleToVote).toBe(false)

    const err = await result.current.vote([[0], [1]]).catch((e) => e)
    expect(err).toBeInstanceOf(NoOpenQuestionError)
    expect(err.questions).toEqual([
      { questionId: 'q-0', status: 'PAUSED' },
      { questionId: 'q-1', status: 'PAUSED' },
    ])
    expect(signCalls.count).toBe(0)
    expect(batches).toHaveLength(0)
  })

  it("reports each waiting question's own status when the process status is mixed", async () => {
    // q-0 closed after its turn, q-1 waits for its own: the process reads PROCESS_UNKNOWN.
    useTwoQuestions(false, ['ENDED', 'PAUSED'])
    mockCheck(() => [q('q-0', UPSTREAM_A, { hasVoted: true }), q('q-1', UPSTREAM_B)])
    mockSignAndRelay()

    const { result } = renderHook(useVoter, { wrapper })
    await connect(result)

    const err = await result.current.vote([[0], [1]]).catch((e) => e)
    expect(err).toBeInstanceOf(NoOpenQuestionError)
    expect(err.questions).toEqual([{ questionId: 'q-1', status: 'PAUSED' }])
  })
})

// A question the voter is not eligible for (`canVote` false) is skipped, never signed.
describe('ElectionProvider — questions the voter is not eligible for', () => {
  const FUTURE_END = '2099-01-01T00:00:00Z'

  /** A one-question process that runs until 2099. */
  function useOneQuestion(over: Record<string, unknown> = {}) {
    server.use(
      http.get('http://localhost/processes/:id', ({ params }) =>
        HttpResponse.json({
          ...mockProcess,
          id: params.id as string,
          endDate: FUTURE_END,
          questions: [{ ...mockProcess.questions[0], id: 'q-0', upstreamId: UPSTREAM_A, status: 'READY', ...over }],
        }),
      ),
    )
  }

  for (const anonymous of [false, true]) {
    it(`skips the ineligible question and relays only the eligible one (${anonymous ? 'anonymous' : 'plain'} census)`, async () => {
      useTwoQuestions(anonymous, ['READY', 'READY'], FUTURE_END)
      mockCheck(() => [q('q-0', UPSTREAM_A), q('q-1', UPSTREAM_B, { canVote: false })])
      const { requested, batches, signCalls } = mockSignAndRelay((txs) => jobOf(txs.map(() => 'completed')))

      const { result } = renderHook(useVoter, { wrapper })
      await connect(result)
      expect(result.current.voteStatus).toEqual({ 'q-1': 'ineligible' })
      expect(result.current.isAbleToVote).toBe(true)

      await act(async () => {
        await result.current.vote([[0], [1]])
      })
      expect(signCalls.count).toBe(1)
      // Only question A was ever sent to the CSP, in either flow (the anonymous
      // flow asks twice, once per round, for the same question).
      expect([...new Set(requested)]).toEqual([UPSTREAM_A])
      expect(batches).toEqual([[expect.any(String)]])
      expect(result.current.voteStatus).toEqual({ 'q-0': 'confirmed', 'q-1': 'ineligible' })
    })
  }

  it('signs both questions when the voter is eligible for all of them', async () => {
    useTwoQuestions(false, ['READY', 'READY'], FUTURE_END)
    mockCheck(() => [q('q-0', UPSTREAM_A), q('q-1', UPSTREAM_B)])
    const { signed, batches } = mockSignAndRelay((txs) => jobOf(txs.map(() => 'completed')))

    const { result } = renderHook(useVoter, { wrapper })
    await connect(result)
    expect(result.current.voteStatus).toEqual({})

    await act(async () => {
      await result.current.vote([[0], [1]])
    })
    expect(signed.map((b) => b.upstreamId)).toEqual([UPSTREAM_A, UPSTREAM_B])
    expect(batches).toEqual([[expect.any(String), expect.any(String)]])
    expect(result.current.voteStatus).toEqual({ 'q-0': 'confirmed', 'q-1': 'confirmed' })
  })

  it('a single eligible question is signed as before', async () => {
    useOneQuestion()
    mockCheck(() => [q('q-0', UPSTREAM_A)])
    const { signed, batches } = mockSignAndRelay((txs) => jobOf(txs.map(() => 'completed')))

    const { result } = renderHook(useVoter, { wrapper })
    await connect(result)
    await act(async () => {
      await result.current.vote([[0]])
    })
    expect(signed.map((b) => b.upstreamId)).toEqual([UPSTREAM_A])
    expect(batches).toEqual([[expect.any(String)]])
    expect(result.current.voteStatus).toEqual({ 'q-0': 'confirmed' })
  })

  it('a single ineligible question: vote() throws NoEligibleQuestionError without signing', async () => {
    useOneQuestion()
    mockCheck(() => [q('q-0', UPSTREAM_A, { canVote: false })])
    const { batches, signCalls } = mockSignAndRelay()

    const { result } = renderHook(useVoter, { wrapper })
    await connect(result)
    expect(result.current.voteStatus).toEqual({ 'q-0': 'ineligible' })

    const err = await result.current.vote([[0]]).catch((e) => e)
    expect(err).toBeInstanceOf(NoEligibleQuestionError)
    expect(err.questions).toEqual([{ questionId: 'q-0' }])
    expect(signCalls.count).toBe(0)
    expect(batches).toHaveLength(0)
  })

  it('a question missing from the check is not ineligible: it is signed', async () => {
    useTwoQuestions(false, ['READY', 'READY'], FUTURE_END)
    mockCheck(() => [q('q-0', UPSTREAM_A)])
    const { signed } = mockSignAndRelay((txs) => jobOf(txs.map(() => 'completed')))

    const { result } = renderHook(useVoter, { wrapper })
    await connect(result)
    expect(result.current.voteStatus).toEqual({})
    await act(async () => {
      await result.current.vote([[0], [1]])
    })
    expect(signed.map((b) => b.upstreamId)).toEqual([UPSTREAM_A, UPSTREAM_B])
  })

  it('a question without a canVote field is not ineligible: it is signed', async () => {
    useTwoQuestions(false, ['READY', 'READY'], FUTURE_END)
    mockCheck(() => [q('q-0', UPSTREAM_A), q('q-1', UPSTREAM_B, { canVote: undefined })])
    const { signed } = mockSignAndRelay((txs) => jobOf(txs.map(() => 'completed')))

    const { result } = renderHook(useVoter, { wrapper })
    await connect(result)
    expect(result.current.voteStatus).toEqual({})
    await act(async () => {
      await result.current.vote([[0], [1]])
    })
    expect(signed.map((b) => b.upstreamId)).toEqual([UPSTREAM_A, UPSTREAM_B])
  })

  it('a failing check on connect leaves no ineligible state, and vote() throws "could not verify"', async () => {
    useTwoQuestions(false, ['READY', 'READY'], FUTURE_END)
    mockCheck(() => [q('q-0', UPSTREAM_A), q('q-1', UPSTREAM_B, { canVote: false })], () => true)
    const { signCalls, batches } = mockSignAndRelay()

    const { result } = renderHook(useVoter, { wrapper })
    await waitFor(() => expect(result.current.election).not.toBeNull())
    await act(async () => {
      await result.current.auth0({ memberNumber: '5' })
    })
    await act(async () => {
      await result.current.auth1(['123456'])
    })
    await act(() => sleep(50))
    expect(result.current.voteStatus).toEqual({})

    const err = await result.current.vote([[0], [1]]).catch((e: unknown) => e)
    expect((err as Error).message).toBe('Could not verify your voting status; try again')
    expect(signCalls.count).toBe(0)
    expect(batches).toHaveLength(0)
  })

  it('every question ineligible (process running): NoEligibleQuestionError lists both, nothing signed or relayed', async () => {
    useTwoQuestions(false, ['READY', 'READY'], FUTURE_END)
    mockCheck(() => [q('q-0', UPSTREAM_A, { canVote: false }), q('q-1', UPSTREAM_B, { canVote: false })])
    const { batches, signCalls } = mockSignAndRelay()

    const { result } = renderHook(useVoter, { wrapper })
    await connect(result)
    expect(result.current.voteStatus).toEqual({ 'q-0': 'ineligible', 'q-1': 'ineligible' })
    expect(result.current.isAbleToVote).toBe(false)

    const err = await result.current.vote([[0], [1]]).catch((e) => e)
    expect(err).toBeInstanceOf(NoEligibleQuestionError)
    expect(err.questions).toEqual([{ questionId: 'q-0' }, { questionId: 'q-1' }])
    expect(signCalls.count).toBe(0)
    expect(batches).toHaveLength(0)
  })

  it('a question already voted with canVote false reads confirmed, not ineligible', async () => {
    useTwoQuestions(false, ['READY', 'READY'], FUTURE_END)
    mockCheck(() => [q('q-0', UPSTREAM_A, { canVote: false, hasVoted: true }), q('q-1', UPSTREAM_B)])
    mockSignInfo(() => [])
    const { signed, batches } = mockSignAndRelay((txs) => jobOf(txs.map(() => 'completed')))

    const { result } = renderHook(useVoter, { wrapper })
    await connect(result)
    expect(result.current.voteStatus).toEqual({})

    await act(async () => {
      await result.current.vote([[0], [1]])
    })
    expect(signed.map((b) => b.upstreamId)).toEqual([UPSTREAM_B])
    expect(batches).toEqual([[expect.any(String)]])
    expect(result.current.voteStatus).toEqual({ 'q-0': 'confirmed', 'q-1': 'confirmed' })
    expect(result.current.hasVoted).toBe(true)
  })

  it('a question signed with canVote false reads unconfirmed, not ineligible', async () => {
    useTwoQuestions(false, ['READY', 'READY'], FUTURE_END)
    mockCheck(() => [q('q-0', UPSTREAM_A, { canVote: false, hasSigned: true }), q('q-1', UPSTREAM_B)])
    mockSignInfo(() => [])
    mockSignAndRelay((txs) => jobOf(txs.map(() => 'completed')))

    const { result } = renderHook(useVoter, { wrapper })
    await connect(result)
    expect(result.current.voteStatus).toEqual({ 'q-0': 'unconfirmed' })
  })

  it('a confirmed question and an ineligible one: vote() throws NoEligibleQuestionError, not UnconfirmedVoteError', async () => {
    useTwoQuestions(false, ['READY', 'READY'], FUTURE_END)
    mockCheck(() => [q('q-0', UPSTREAM_A, { hasVoted: true }), q('q-1', UPSTREAM_B, { canVote: false })])
    mockSignInfo(() => [])
    const { signCalls, batches } = mockSignAndRelay()

    const { result } = renderHook(useVoter, { wrapper })
    await connect(result)
    const err = await result.current.vote([[0], [1]]).catch((e) => e)
    expect(err).toBeInstanceOf(NoEligibleQuestionError)
    expect(err).not.toBeInstanceOf(UnconfirmedVoteError)
    expect(err.questions).toEqual([{ questionId: 'q-1' }])
    expect(signCalls.count).toBe(0)
    expect(batches).toHaveLength(0)
  })

  it('an ended process reads no ineligible state, and vote() throws NoOpenQuestionError as today', async () => {
    useTwoQuestions(false, ['ENDED', 'ENDED'])
    mockCheck(() => [q('q-0', UPSTREAM_A, { canVote: false }), q('q-1', UPSTREAM_B, { canVote: false })])
    const { signCalls, batches } = mockSignAndRelay()

    const { result } = renderHook(useVoter, { wrapper })
    await connect(result)
    expect(result.current.voteStatus).toEqual({})

    const err = await result.current.vote([[0], [1]]).catch((e) => e)
    expect(err).toBeInstanceOf(NoOpenQuestionError)
    expect(signCalls.count).toBe(0)
    expect(batches).toHaveLength(0)
  })

  it('a process past its end date with questions still live: canVote false reads open and is signed, as on main', async () => {
    // Default endDate is in the past, the questions are live on the wire: not "running" per the guard.
    useTwoQuestions(false, ['READY', 'READY'])
    mockCheck(() => [q('q-0', UPSTREAM_A, { canVote: false }), q('q-1', UPSTREAM_B, { canVote: false })])
    const { signed, batches } = mockSignAndRelay((txs) => jobOf(txs.map(() => 'completed')))

    const { result } = renderHook(useVoter, { wrapper })
    await connect(result)
    expect(result.current.voteStatus).toEqual({})

    await act(async () => {
      await result.current.vote([[0], [1]])
    })
    expect(signed.map((b) => b.upstreamId)).toEqual([UPSTREAM_A, UPSTREAM_B])
    expect(batches).toEqual([[expect.any(String), expect.any(String)]])
    expect(result.current.voteStatus).toEqual({ 'q-0': 'confirmed', 'q-1': 'confirmed' })
  })

  it('the form shape (empty ballot and undefined memo for an ineligible question) signs only the eligible one', async () => {
    useTwoQuestions(false, ['READY', 'READY'], FUTURE_END)
    mockCheck(() => [q('q-0', UPSTREAM_A), q('q-1', UPSTREAM_B, { canVote: false })])
    const { requested, batches } = mockSignAndRelay((txs) => jobOf(txs.map(() => 'completed')))

    const { result } = renderHook(useVoter, { wrapper })
    await connect(result)
    await act(async () => {
      await result.current.vote([[0], []], [undefined, undefined])
    })
    expect(requested).toEqual([UPSTREAM_A])
    expect(batches).toEqual([[expect.any(String)]])
    expect(result.current.voteStatus).toEqual({ 'q-0': 'confirmed', 'q-1': 'ineligible' })
  })

  it('an ineligible question that turns eligible: an empty ballot is refused before anything is signed, then a real answer votes', async () => {
    useTwoQuestions(false, ['READY', 'READY'], FUTURE_END)
    let q1Eligible = false
    mockCheck(() => [q('q-0', UPSTREAM_A), q('q-1', UPSTREAM_B, { canVote: q1Eligible })])
    const { signed, requested, batches, signCalls } = mockSignAndRelay((txs) => jobOf(txs.map(() => 'completed')))

    const { result } = renderHook(useVoter, { wrapper })
    await connect(result)
    expect(result.current.voteStatus).toEqual({ 'q-1': 'ineligible' })

    // The voter is added to q-1's subset after the form was shown.
    q1Eligible = true
    let err: unknown
    await act(async () => {
      err = await result.current.vote([[0], []]).catch((e) => e)
    })
    expect((err as Error).message).toBe('Your eligibility changed since the ballot was shown. Review your answers and vote again.')
    expect(signCalls.count).toBe(0)
    expect(requested).toEqual([])
    expect(batches).toHaveLength(0)
    // The fresh check is applied: q-1 is no longer shown as ineligible.
    expect(result.current.voteStatus).toEqual({})

    await act(async () => {
      await result.current.vote([[0], [1]])
    })
    expect(signed.map((b) => b.upstreamId)).toEqual([UPSTREAM_A, UPSTREAM_B])
    expect(batches).toEqual([[expect.any(String), expect.any(String)]])
    expect(result.current.voteStatus).toEqual({ 'q-0': 'confirmed', 'q-1': 'confirmed' })
  })

  it('an ineligible question that turns eligible: a real answer is signed normally', async () => {
    useTwoQuestions(false, ['READY', 'READY'], FUTURE_END)
    let q1Eligible = false
    mockCheck(() => [q('q-0', UPSTREAM_A), q('q-1', UPSTREAM_B, { canVote: q1Eligible })])
    const { signed, batches } = mockSignAndRelay((txs) => jobOf(txs.map(() => 'completed')))

    const { result } = renderHook(useVoter, { wrapper })
    await connect(result)
    q1Eligible = true
    await act(async () => {
      await result.current.vote([[0], [1]])
    })
    expect(signed.map((b) => b.upstreamId)).toEqual([UPSTREAM_A, UPSTREAM_B])
    expect(batches).toEqual([[expect.any(String), expect.any(String)]])
    expect(result.current.voteStatus).toEqual({ 'q-0': 'confirmed', 'q-1': 'confirmed' })
  })

  it('an empty ballot for an ordinary open question is signed and relayed, as on main', async () => {
    // main never validates ballot contents: an empty choices list is encoded and relayed.
    useOneQuestion()
    mockCheck(() => [q('q-0', UPSTREAM_A)])
    const { signed, batches } = mockSignAndRelay((txs) => jobOf(txs.map(() => 'completed')))

    const { result } = renderHook(useVoter, { wrapper })
    await connect(result)
    await act(async () => {
      await result.current.vote([[]])
    })
    expect(signed.map((b) => b.upstreamId)).toEqual([UPSTREAM_A])
    expect(batches).toEqual([[expect.any(String)]])
    expect(result.current.voteStatus).toEqual({ 'q-0': 'confirmed' })
  })

  it('an anonymous signed question that is also canVote false reads signed, not ineligible, as on main', async () => {
    useTwoQuestions(true, ['READY', 'READY'], FUTURE_END)
    mockCheck(() => [q('q-0', UPSTREAM_A, { canVote: false, hasSigned: true }), q('q-1', UPSTREAM_B)])
    mockSignAndRelay()

    const { result } = renderHook(useVoter, { wrapper })
    await connect(result)
    expect(result.current.voteStatus).toEqual({ 'q-0': 'signed' })
  })

  it('a voter outside the census reads no ineligible state', async () => {
    useTwoQuestions(false, ['READY', 'READY'], FUTURE_END)
    server.use(
      http.post('http://localhost/processes/:processId/check', () =>
        HttpResponse.json({
          belongsToProcess: false,
          weight: MOCK_WEIGHT_HEX,
          questions: [q('q-0', UPSTREAM_A, { canVote: false }), q('q-1', UPSTREAM_B, { canVote: false })],
        }),
      ),
    )

    const { result } = renderHook(useVoter, { wrapper })
    await waitFor(() => expect(result.current.election).not.toBeNull())
    await act(async () => {
      await result.current.auth0({ memberNumber: '5' })
    })
    await act(async () => {
      await result.current.auth1(['123456'])
    })
    await act(() => sleep(50))
    expect(result.current.isInCensus).toBe(false)
    expect(result.current.voteStatus).toEqual({})
  })

  it('q-0 paused and eligible, q-1 ongoing and ineligible: NoOpenQuestionError lists only q-0', async () => {
    useTwoQuestions(false, ['PAUSED', 'READY'], FUTURE_END)
    mockCheck(() => [q('q-0', UPSTREAM_A), q('q-1', UPSTREAM_B, { canVote: false })])
    const { signCalls, batches } = mockSignAndRelay()

    const { result } = renderHook(useVoter, { wrapper })
    await connect(result)

    const err = await result.current.vote([[0], [1]]).catch((e) => e)
    expect(err).toBeInstanceOf(NoOpenQuestionError)
    expect(err.questions).toEqual([{ questionId: 'q-0', status: 'PAUSED' }])
    expect(signCalls.count).toBe(0)
    expect(batches).toHaveLength(0)
  })

  it('an ineligible open secret question without keys does not block the eligible question', async () => {
    server.use(
      http.get('http://localhost/processes/:id', ({ params }) =>
        HttpResponse.json({
          ...mockProcess,
          id: params.id as string,
          endDate: FUTURE_END,
          questions: [
            { ...mockProcess.questions[0], id: 'q-0', upstreamId: UPSTREAM_A, status: 'READY' },
            { ...mockProcess.questions[0], id: 'q-1', upstreamId: UPSTREAM_B, status: 'READY', secretUntilTheEnd: true },
          ],
        }),
      ),
    )
    mockCheck(() => [q('q-0', UPSTREAM_A), q('q-1', UPSTREAM_B, { canVote: false })])
    const { signed, batches } = mockSignAndRelay((txs) => jobOf(txs.map(() => 'completed')))

    const { result } = renderHook(useVoter, { wrapper })
    await connect(result)
    await act(async () => {
      await result.current.vote([[0], [1]])
    })
    expect(signed.map((b) => b.upstreamId)).toEqual([UPSTREAM_A])
    expect(batches).toEqual([[expect.any(String)]])
    expect(result.current.voteStatus).toEqual({ 'q-0': 'confirmed', 'q-1': 'ineligible' })
  })
})

describe('ElectionProvider — a question opens or closes while a stored tx is re-sent', () => {
  it('still publishes what the in-flight re-send confirmed', async () => {
    const NULLIFIER = '5a'.repeat(32)
    let statuses = ['ONGOING', 'PAUSED']
    let landed = false
    server.use(
      http.get('http://localhost/processes/:id', ({ params }) =>
        HttpResponse.json({
          ...mockProcess,
          id: params.id as string,
          questions: [
            { ...mockProcess.questions[0], id: 'q-0', upstreamId: UPSTREAM_A, status: statuses[0] },
            { ...mockProcess.questions[0], id: 'q-1', upstreamId: UPSTREAM_B, status: statuses[1] },
          ],
        }),
      ),
      http.post('http://localhost/votes', async () => {
        // The organizer pauses q-0 and opens q-1 while the relay is in flight.
        statuses = ['PAUSED', 'ONGOING']
        await new Promise((r) => setTimeout(r, 300))
        landed = true
        return HttpResponse.json({ jobId: 'job-0' }, { status: 202 })
      }),
      http.get('http://localhost/jobs/:jobId', () =>
        HttpResponse.json({
          jobId: 'job-0',
          status: 'completed',
          type: 'relay_votes',
          result: { votes: [{ processId: 'p', nullifier: NULLIFIER, status: 'completed', voteID: NULLIFIER }] },
        }),
      ),
    )
    mockCheck(() => [q('q-0', UPSTREAM_A, { hasSigned: true, hasVoted: landed }), q('q-1', UPSTREAM_B)])
    mockSignInfo(() => [{ questionId: 'q-0', nullifier: NULLIFIER }])
    savePendingVote(UPSTREAM_A, { owner: OWNER, nullifier: '0x' + NULLIFIER, txPayload: 'cafebabe', savedAt: 1 })

    const { result } = renderHook(useVoter, {
      wrapper: ({ children }) => (
        <TestProvider>
          <ElectionProvider
            id={mockProcess.id}
            queryOptions={{ refetchInterval: 20 }}
            voteOptions={{ jobTimeoutMs: 300, reconcile: { attempts: 3, intervalMs: 20 } }}
          >
            {children}
          </ElectionProvider>
        </TestProvider>
      ),
    })
    await connect(result)
    await waitFor(() => expect(result.current.election?.questions[0].status).toBe('PAUSED'))
    await waitFor(() => expect(landed).toBe(true))
    await waitFor(() => expect(result.current.voting).toBe(false))

    expect(result.current.pendingVotes).toEqual({})
    expect(result.current.voteStatus['q-0']).toBe('confirmed')
    expect(result.current.voteIds['q-0']).toBe(NULLIFIER)
    expect(result.current.voterQuestions.find((v) => v.questionId === 'q-0')?.hasVoted).toBe(true)
  })
})

describe('ElectionProvider — a question opens while vote() is relaying', () => {
  it('keeps the vote result when a voter-state snapshot taken before the relay landed arrives late', async () => {
    const NULLIFIER = '6b'.repeat(32)
    let statuses = ['ONGOING', 'PAUSED']
    let relaying = false
    let lateCheckDone = false
    mockSignAndRelay(() => jobOf(['completed'], [NULLIFIER]))
    mockSignInfo(() => [])
    server.use(
      http.get('http://localhost/processes/:id', ({ params }) =>
        HttpResponse.json({
          ...mockProcess,
          id: params.id as string,
          questions: [
            { ...mockProcess.questions[0], id: 'q-0', upstreamId: UPSTREAM_A, status: statuses[0] },
            { ...mockProcess.questions[0], id: 'q-1', upstreamId: UPSTREAM_B, status: statuses[1] },
          ],
        }),
      ),
      http.post('http://localhost/processes/:processId/check', async () => {
        if (!relaying) {
          return HttpResponse.json({
            belongsToProcess: true,
            weight: MOCK_WEIGHT_HEX,
            questions: [q('q-0', UPSTREAM_A), q('q-1', UPSTREAM_B)],
          })
        }
        // The connect effect's check, sent during the relay: it answers late,
        // with the snapshot from before the relay landed.
        await new Promise((r) => setTimeout(r, 600))
        lateCheckDone = true
        return HttpResponse.json({
          belongsToProcess: true,
          weight: MOCK_WEIGHT_HEX,
          questions: [q('q-0', UPSTREAM_A, { hasSigned: true }), q('q-1', UPSTREAM_B)],
        })
      }),
      http.post('http://localhost/votes', async () => {
        // q-1 opens while the relay is in flight, so the connect effect re-runs.
        statuses = ['ONGOING', 'ONGOING']
        relaying = true
        await new Promise((r) => setTimeout(r, 300))
        relaying = false
        return HttpResponse.json({ jobId: 'job-0' }, { status: 202 })
      }),
    )

    const { result } = renderHook(useVoter, {
      wrapper: ({ children }) => (
        <TestProvider>
          <ElectionProvider
            id={mockProcess.id}
            queryOptions={{ refetchInterval: 20 }}
            voteOptions={{ jobTimeoutMs: 300, reconcile: { attempts: 3, intervalMs: 20 } }}
          >
            {children}
          </ElectionProvider>
        </TestProvider>
      ),
    })
    await connect(result)

    await act(async () => {
      await result.current.vote([[0], [1]])
    })
    await waitFor(() => expect(lateCheckDone).toBe(true))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })

    expect(result.current.voteStatus['q-0']).toBe('confirmed')
    expect(result.current.voteIds['q-0']).toBe(NULLIFIER)
    expect(result.current.voterQuestions.find((v) => v.questionId === 'q-0')?.hasVoted).toBe(true)
  })
})

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * q-0 opens and is relayed by vote(); q-1 opens mid-relay and has a stored tx from
 * an earlier session. The connect effect's /check answers `checkDelayMs` after it
 * was sent, with the pre-relay snapshot, so it may land during or after the relay.
 */
async function resendsStoredTxOpenedMidVote(checkDelayMs: number) {
  const NULLIFIER_0 = '5a'.repeat(32)
  const NULLIFIER_1 = '6b'.repeat(32)
  let statuses = ['ONGOING', 'PAUSED']
  let relaying = false
  const relayed: string[][] = []
  mockSignAndRelay(() => ({}))
  mockSignInfo(() => [{ questionId: 'q-1', nullifier: NULLIFIER_1 }])
  savePendingVote(UPSTREAM_B, { owner: OWNER, nullifier: '0x' + NULLIFIER_1, txPayload: 'cafebabe', savedAt: 1 })
  server.use(
    http.get('http://localhost/processes/:id', ({ params }) =>
      HttpResponse.json({
        ...mockProcess,
        id: params.id as string,
        questions: [
          { ...mockProcess.questions[0], id: 'q-0', upstreamId: UPSTREAM_A, status: statuses[0] },
          { ...mockProcess.questions[0], id: 'q-1', upstreamId: UPSTREAM_B, status: statuses[1] },
        ],
      }),
    ),
    http.post('http://localhost/processes/:processId/check', async () => {
      if (relaying) await sleep(checkDelayMs)
      return HttpResponse.json({
        belongsToProcess: true,
        weight: MOCK_WEIGHT_HEX,
        questions: [q('q-0', UPSTREAM_A, { hasSigned: relaying }), q('q-1', UPSTREAM_B, { hasSigned: true })],
      })
    }),
    http.post('http://localhost/votes', async ({ request }) => {
      const body = (await request.json()) as { votes: Array<{ txPayload: string }> }
      relayed.push(body.votes.map((v) => v.txPayload))
      if (relayed.length === 1) {
        statuses = ['ONGOING', 'ONGOING']
        relaying = true
        await sleep(300)
        relaying = false
      }
      return HttpResponse.json({ jobId: `job-${relayed.length - 1}` }, { status: 202 })
    }),
    http.get('http://localhost/jobs/:jobId', ({ params }) => {
      const nullifier = params.jobId === 'job-0' ? NULLIFIER_0 : NULLIFIER_1
      return HttpResponse.json({
        jobId: params.jobId,
        type: 'relay_votes',
        status: 'completed',
        result: { votes: [{ processId: 'p', nullifier, status: 'completed', voteID: nullifier }] },
      })
    }),
  )

  const { result } = renderHook(useVoter, {
    wrapper: ({ children }) => (
      <TestProvider>
        <ElectionProvider
          id={mockProcess.id}
          queryOptions={{ refetchInterval: 20 }}
          voteOptions={{ jobTimeoutMs: 300, reconcile: { attempts: 3, intervalMs: 20 } }}
        >
          {children}
        </ElectionProvider>
      </TestProvider>
    ),
  })
  await connect(result)
  await act(async () => {
    await result.current.vote([[0], [1]])
  })

  // The stored tx of q-1 is posted once it is open, with no new signature.
  await waitFor(() => expect(relayed).toHaveLength(2))
  await waitFor(() => expect(result.current.voting).toBe(false))
  expect(relayed[1]).toEqual(['cafebabe'])
  await waitFor(() => expect(result.current.pendingVotes).toEqual({}))
  expect(result.current.voteStatus['q-0']).toBe('confirmed')
  expect(result.current.voteStatus['q-1']).toBe('confirmed')
}

describe('ElectionProvider — voter state around a vote()', () => {
  it('re-sends a stored tx of a question that opens mid-vote, when the check lands after vote() settles', async () => {
    await resendsStoredTxOpenedMidVote(600)
  })

  it('re-sends a stored tx of a question that opens mid-vote, when the check lands while the relay is in flight', async () => {
    await resendsStoredTxOpenedMidVote(100)
  })

  it('does not write voter A\'s settled vote into voter B\'s session', async () => {
    const NULLIFIER = '6b'.repeat(32)
    let statuses = ['ONGOING', 'PAUSED']
    let release: () => void = () => {}
    const held = new Promise<void>((r) => (release = r))
    let holding = false
    mockSignAndRelay(() => jobOf(['completed'], [NULLIFIER]))
    mockSignInfo(() => [])
    mockCheck(() => [q('q-0', UPSTREAM_A), q('q-1', UPSTREAM_B)])
    server.use(
      http.get('http://localhost/processes/:id', ({ params }) =>
        HttpResponse.json({
          ...mockProcess,
          id: params.id as string,
          questions: [
            { ...mockProcess.questions[0], id: 'q-0', upstreamId: UPSTREAM_A, status: statuses[0] },
            { ...mockProcess.questions[0], id: 'q-1', upstreamId: UPSTREAM_B, status: statuses[1] },
          ],
        }),
      ),
      http.post('http://localhost/votes', async () => {
        holding = true
        await held
        return HttpResponse.json({ jobId: 'job-0' }, { status: 202 })
      }),
    )

    const { result } = renderHook(useVoter, {
      wrapper: ({ children }) => (
        <TestProvider>
          <ElectionProvider
            id={mockProcess.id}
            queryOptions={{ refetchInterval: 20 }}
            voteOptions={{ jobTimeoutMs: 300, reconcile: { attempts: 3, intervalMs: 20 } }}
          >
            {children}
          </ElectionProvider>
        </TestProvider>
      ),
    })
    await connect(result)

    let voting: Promise<string> = Promise.resolve('')
    await act(async () => {
      voting = result.current.vote([[0], [1]])
      await waitFor(() => expect(holding).toBe(true))
    })
    // Voter B identifies while A's relay is still open.
    await act(async () => {
      await result.current.auth0({ memberNumber: '6' })
    })
    await act(async () => {
      await result.current.auth1(['123456'])
    })
    await waitFor(() => expect(result.current.isInCensus).toBe(true))

    release()
    await act(async () => {
      await voting
    })
    // q-1 opens: B's connect effect re-runs and applies a fresh snapshot.
    statuses = ['ONGOING', 'ONGOING']
    await act(() => sleep(150))

    expect(result.current.voteStatus['q-0']).not.toBe('confirmed')
    expect(result.current.voterQuestions.find((v) => v.questionId === 'q-0')?.hasVoted).toBe(false)
    expect(result.current.hasVoted).toBe(false)
  })

  it('does not leave voter B a \'submitting\' status from voter A\'s vote() signing', async () => {
    const NULLIFIER = '6b'.repeat(32)
    let statuses = ['ONGOING', 'PAUSED']
    let release: () => void = () => {}
    const held = new Promise<void>((r) => (release = r))
    let holding = false
    mockSignAndRelay(() => jobOf(['completed'], [NULLIFIER]))
    mockSignInfo(() => [])
    mockCheck(() => [q('q-0', UPSTREAM_A), q('q-1', UPSTREAM_B)])
    server.use(
      http.get('http://localhost/processes/:id', ({ params }) =>
        HttpResponse.json({
          ...mockProcess,
          id: params.id as string,
          questions: [
            { ...mockProcess.questions[0], id: 'q-0', upstreamId: UPSTREAM_A, status: statuses[0] },
            { ...mockProcess.questions[0], id: 'q-1', upstreamId: UPSTREAM_B, status: statuses[1] },
          ],
        }),
      ),
      http.post('http://localhost/processes/:processId/sign-batch', async ({ request }) => {
        const body = (await request.json()) as { ballots: Array<{ upstreamId: string }> }
        holding = true
        await held
        return HttpResponse.json({
          signatures: body.ballots.map((b) => ({ upstreamId: b.upstreamId, signature: MOCK_CSP_SIGNATURE, weight: MOCK_WEIGHT_HEX })),
        })
      }),
    )

    const { result } = renderHook(useVoter, {
      wrapper: ({ children }) => (
        <TestProvider>
          <ElectionProvider
            id={mockProcess.id}
            queryOptions={{ refetchInterval: 20 }}
            voteOptions={{ jobTimeoutMs: 300, reconcile: { attempts: 3, intervalMs: 20 } }}
          >
            {children}
          </ElectionProvider>
        </TestProvider>
      ),
    })
    await connect(result)

    let voting: Promise<string> = Promise.resolve('')
    await act(async () => {
      voting = result.current.vote([[0], [1]])
      await waitFor(() => expect(holding).toBe(true))
    })
    // Voter B identifies while A's relay is still open.
    await act(async () => {
      await result.current.auth0({ memberNumber: '6' })
    })
    await act(async () => {
      await result.current.auth1(['123456'])
    })
    await waitFor(() => expect(result.current.isInCensus).toBe(true))

    release()
    await act(async () => {
      await voting
    })
    // q-1 opens: B's connect effect re-runs and applies a fresh snapshot.
    statuses = ['ONGOING', 'ONGOING']
    await act(() => sleep(150))

    expect(result.current.voteStatus['q-0']).not.toBe('submitting')
  })

  it.each([
    ['A voted q-0', ['q-0']],
    ['A voted every question', ['q-0', 'q-1']],
  ])('does not write voter A\'s vote() starting state into voter B\'s session (%s)', async (_name, votedByA) => {
    useTwoQuestions(false, ['ONGOING', 'ONGOING'])
    let voter: 'A' | 'B' = 'A'
    let armed = false
    let holding = false
    let release: () => void = () => {}
    const held = new Promise<void>((r) => (release = r))
    mockSignAndRelay(() => jobOf(['completed'], ['6b'.repeat(32)]))
    mockSignInfo(() => [])
    server.use(
      http.post('http://localhost/processes/:processId/check', async () => {
        const body = {
          belongsToProcess: true,
          weight: MOCK_WEIGHT_HEX,
          questions: [
            q('q-0', UPSTREAM_A, { hasVoted: voter === 'A' && votedByA.includes('q-0') }),
            q('q-1', UPSTREAM_B, { hasVoted: voter === 'A' && votedByA.includes('q-1') }),
          ],
        }
        if (armed) {
          armed = false
          holding = true
          await held
        }
        return HttpResponse.json(body)
      }),
    )

    const { result } = renderHook(useVoter, {
      wrapper: ({ children }) => (
        <TestProvider>
          <ElectionProvider id={mockProcess.id} voteOptions={{ jobTimeoutMs: 300, reconcile: { attempts: 3, intervalMs: 20 } }}>
            {children}
          </ElectionProvider>
        </TestProvider>
      ),
    })
    await connect(result)

    let voting: Promise<string> = Promise.resolve('')
    await act(async () => {
      armed = true
      voting = result.current.vote([[0], [1]]).catch(() => '')
      await waitFor(() => expect(holding).toBe(true))
    })
    // Voter B identifies while A's /check is still in flight.
    voter = 'B'
    await act(async () => {
      await result.current.auth0({ memberNumber: '6' })
    })
    await act(async () => {
      await result.current.auth1(['123456'])
    })
    await waitFor(() => expect(result.current.isInCensus).toBe(true))

    release()
    await act(async () => {
      await voting
    })
    await act(() => sleep(100))

    const values = Object.values(result.current.voteStatus)
    expect(values).not.toContain('confirmed')
    expect(values).not.toContain('signing')
    expect(result.current.hasVoted).toBe(false)
  })

  it('keeps the connect snapshot when vote() throws before it applies state', async () => {
    useTwoQuestions()
    let checks = 0
    server.use(
      http.post('http://localhost/processes/:processId/check', async () => {
        // The connect check is still pending while the integrator calls vote().
        if (++checks === 1) await sleep(300)
        return HttpResponse.json({ belongsToProcess: true, weight: MOCK_WEIGHT_HEX, questions: [q('q-0', UPSTREAM_A), q('q-1', UPSTREAM_B)] })
      }),
    )
    mockSignAndRelay()

    const { result } = renderHook(useVoter, { wrapper })
    await waitFor(() => expect(result.current.election).not.toBeNull())
    await act(async () => {
      await result.current.auth0({ memberNumber: '5' })
    })
    await act(async () => {
      await result.current.auth1(['123456'])
    })
    // A wrong ballot count throws before any state is applied.
    const err = await result.current.vote([[0]]).catch((e) => e)
    expect(err).toBeInstanceOf(Error)

    await waitFor(() => expect(result.current.isInCensus).toBe(true))
    expect(result.current.voterQuestions).toHaveLength(2)
  })
})
