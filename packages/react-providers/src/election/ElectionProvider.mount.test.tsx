import { StrictMode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { MOCK_WEIGHT_HEX, mockProcess } from '../../../../mocks/handlers'
import { server } from '../../../../mocks/server'
import { TestProvider } from '../test-utils'
import { ElectionProvider, useElection } from './ElectionProvider'
import { listPendingVotes, savePendingVote } from './pending-votes'

// Connect / reload: a pending entry of the current voter is re-sent once, with
// no signing; a confirmed anonymous entry is re-verified.

const UPSTREAM = mockProcess.questions[0].upstreamId
/** sha256('{"memberNumber":"5"}') — the owner of the voter `connect()` identifies. */
const OWNER = '8167d5dc4919186f999eb3dd105c40ebf7f29ff46ba329a0232a7fbcdabd1549'
const NULLIFIER = '0x' + '5a'.repeat(32)
const STORED_TX = 'cafebabe'

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <StrictMode>
      <TestProvider>
        <ElectionProvider id={mockProcess.id} voteOptions={{ jobTimeoutMs: 300, reconcile: { attempts: 2, intervalMs: 20 } }}>
          {children}
        </ElectionProvider>
      </TestProvider>
    </StrictMode>
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
}

function useProcess(over: { anonymous?: boolean; status?: string } = {}) {
  server.use(
    http.get('http://localhost/processes/:id', ({ params }) =>
      HttpResponse.json({
        ...mockProcess,
        id: params.id as string,
        census: { ...mockProcess.census, anonymous: !!over.anonymous },
        questions: [{ ...mockProcess.questions[0], status: over.status ?? 'ONGOING' }],
      }),
    ),
  )
}

/** /check reporting q-0 signed; on chain once `onChain()` says so. */
function mockCheck(onChain: () => boolean) {
  server.use(
    http.post('http://localhost/processes/:processId/check', () =>
      HttpResponse.json({
        belongsToProcess: true,
        weight: MOCK_WEIGHT_HEX,
        questions: [{ questionId: 'q-0', upstreamId: UPSTREAM, canVote: true, hasSigned: true, hasVoted: onChain() }],
      }),
    ),
    http.post('http://localhost/processes/:processId/sign-info', () =>
      HttpResponse.json({ consumed: [{ questionId: 'q-0', upstreamId: UPSTREAM, nullifier: NULLIFIER.slice(2), at: '' }] }),
    ),
  )
}

/** Counts CSP signing and records relayed batches; a relay takes `delayMs` and its job completes. */
function mockRelay({ delayMs = 0, status = 202 }: { delayMs?: number; status?: number } = {}) {
  const batches: string[][] = []
  const signCalls = { count: 0 }
  server.use(
    http.post('http://localhost/processes/:processId/sign-batch', () => {
      signCalls.count++
      return HttpResponse.json({ signatures: [] })
    }),
    http.post('http://localhost/processes/:processId/blind-point', () => {
      signCalls.count++
      return HttpResponse.json({ points: [] })
    }),
    http.post('http://localhost/votes', async ({ request }) => {
      const body = (await request.json()) as { votes: Array<{ txPayload: string }> }
      batches.push(body.votes.map((v) => v.txPayload))
      await new Promise((r) => setTimeout(r, delayMs))
      if (status !== 202) return HttpResponse.json({ error: 'invalid vote' }, { status })
      return HttpResponse.json({ jobId: 'job-mount' }, { status: 202 })
    }),
    http.get('http://localhost/jobs/:jobId', () =>
      HttpResponse.json({
        jobId: 'job-mount',
        status: 'completed',
        type: 'relay_votes',
        result: { votes: [{ processId: UPSTREAM, nullifier: NULLIFIER.slice(2), status: 'completed', voteID: NULLIFIER.slice(2) }] },
      }),
    ),
  )
  return { batches, signCalls }
}

beforeEach(() => sessionStorage.clear())

describe('ElectionProvider — pending votes on connect', () => {
  it('AC6: re-sends a pending entry exactly once under StrictMode, with voting=true while it runs', async () => {
    useProcess()
    savePendingVote(UPSTREAM, { owner: OWNER, nullifier: NULLIFIER, txPayload: STORED_TX, savedAt: 1 })
    const { batches, signCalls } = mockRelay({ delayMs: 80 })
    mockCheck(() => batches.length > 0)

    const { result } = renderHook(useVoter, { wrapper })
    await connect(result)
    await waitFor(() => expect(result.current.voting).toBe(true))
    expect(result.current.pendingVotes).toEqual({ 'q-0': true })
    // A vote() while the re-send runs is refused, not raced.
    await expect(result.current.vote([[0]])).rejects.toThrow(/still being relayed/)

    await waitFor(() => expect(result.current.voting).toBe(false))
    expect(batches).toEqual([[STORED_TX]])
    expect(signCalls.count).toBe(0)
    expect(result.current.voteStatus).toEqual({ 'q-0': 'confirmed' })
    expect(result.current.hasVoted).toBe(true)
    expect(result.current.pendingVotes).toEqual({})
    expect(listPendingVotes(UPSTREAM)).toEqual([])
  })

  it('AC6: does not re-send while the process is not ONGOING', async () => {
    useProcess({ status: 'PAUSED' })
    savePendingVote(UPSTREAM, { owner: OWNER, nullifier: NULLIFIER, txPayload: STORED_TX, savedAt: 1 })
    const { batches } = mockRelay()
    mockCheck(() => false)

    const { result } = renderHook(useVoter, { wrapper })
    await connect(result)
    await waitFor(() => expect(result.current.pendingVotes).toEqual({ 'q-0': true }))
    await new Promise((r) => setTimeout(r, 50))
    expect(batches).toHaveLength(0)
    expect(listPendingVotes(UPSTREAM)).toHaveLength(1)
  })

  it('a failed re-send leaves the entry, marks the question failed and clears voting', async () => {
    useProcess()
    savePendingVote(UPSTREAM, { owner: OWNER, nullifier: NULLIFIER, txPayload: STORED_TX, savedAt: 1 })
    const { batches } = mockRelay({ status: 400 })
    mockCheck(() => false)

    const { result } = renderHook(useVoter, { wrapper })
    await connect(result)
    await waitFor(() => expect(result.current.voteStatus).toEqual({ 'q-0': 'failed' }))
    expect(batches).toHaveLength(1)
    expect(result.current.voting).toBe(false)
    expect(result.current.hasVoted).toBe(false)
    expect(result.current.pendingVotes).toEqual({ 'q-0': true })
    expect(listPendingVotes(UPSTREAM)[0]).toMatchObject({ txPayload: STORED_TX })
  })

  it.each([
    ['lands', 202],
    ['is refused', 400],
  ])('clearing the session while a re-send runs leaves no vote state behind when the relay %s', async (_name, status) => {
    useProcess()
    savePendingVote(UPSTREAM, { owner: OWNER, nullifier: NULLIFIER, txPayload: STORED_TX, savedAt: 1 })
    const { batches } = mockRelay({ delayMs: 80, status })
    mockCheck(() => batches.length > 0 && status === 202)

    const { result } = renderHook(useVoter, { wrapper })
    await connect(result)
    await waitFor(() => expect(result.current.voting).toBe(true))
    act(() => result.current.clearVoter())
    await waitFor(() => expect(result.current.voting).toBe(false))
    expect(batches).toEqual([[STORED_TX]])
    expect(result.current.connected).toBe(false)
    expect(result.current.voteStatus).toEqual({})
    expect(result.current.pendingVotes).toEqual({})
    expect(result.current.hasVoted).toBe(false)
  })

  it('drops every stored entry once the process is over', async () => {
    useProcess({ status: 'ENDED' })
    savePendingVote(UPSTREAM, { owner: 'anyone', nullifier: NULLIFIER, txPayload: STORED_TX, savedAt: 1 })
    const { result } = renderHook(useVoter, { wrapper })
    await waitFor(() => expect(result.current.status).toBe('ENDED'))
    await waitFor(() => expect(listPendingVotes(UPSTREAM)).toEqual([]))
  })

  describe('AC10: anonymous census', () => {
    /** /check for a blind census on the new backend: signed, never hasVoted. */
    function mockBlindCheck() {
      server.use(
        http.post('http://localhost/processes/:processId/check', () =>
          HttpResponse.json({
            belongsToProcess: true,
            weight: MOCK_WEIGHT_HEX,
            questions: [{ questionId: 'q-0', upstreamId: UPSTREAM, canVote: true, hasSigned: true, hasVoted: false }],
          }),
        ),
      )
    }

    function mockVerify() {
      const calls: string[][] = []
      server.use(
        http.post('http://localhost/votes/verify', async ({ request }) => {
          const { nullifiers } = (await request.json()) as { nullifiers: string[] }
          calls.push(nullifiers)
          return HttpResponse.json({ votes: nullifiers.map((n) => ({ nullifier: n.replace(/^0x/, ''), verified: true })) })
        }),
      )
      return calls
    }

    it('same tab: a confirmed entry is re-verified → hasVoted, with no sign or relay', async () => {
      useProcess({ anonymous: true })
      savePendingVote(UPSTREAM, { owner: OWNER, nullifier: NULLIFIER, savedAt: 1, confirmedAt: 2 })
      mockBlindCheck()
      const verifyCalls = mockVerify()
      const { batches, signCalls } = mockRelay()

      const { result } = renderHook(useVoter, { wrapper })
      await connect(result)
      await waitFor(() => expect(result.current.hasVoted).toBe(true))
      expect(verifyCalls[0]).toEqual([NULLIFIER])
      expect(result.current.voteIds).toEqual({ 'q-0': NULLIFIER.slice(2) })
      expect(result.current.voterQuestions[0].hasVoted).toBe(true)
      expect(result.current.isAbleToVote).toBe(false)
      expect(batches).toHaveLength(0)
      expect(signCalls.count).toBe(0)
    })

    it('new tab: nothing stored → signed, not voted, not able to vote', async () => {
      useProcess({ anonymous: true })
      mockBlindCheck()
      const verifyCalls = mockVerify()

      const { result } = renderHook(useVoter, { wrapper })
      await connect(result)
      await waitFor(() => expect(result.current.voteStatus).toEqual({ 'q-0': 'signed' }))
      expect(result.current.hasVoted).toBe(false)
      expect(result.current.isAbleToVote).toBe(false)
      expect(verifyCalls).toHaveLength(0)
    })
  })
})
