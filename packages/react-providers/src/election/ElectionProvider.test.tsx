import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { CAbundle, ProofCA_Type, SignedTx, Tx } from '@vocdoni/proto/vochain'
import { blindMessageFromBundle, fromHex } from '@vocdoni/api-voting'
import type { VotingProcessResponse } from '@vocdoni/api-types'
import { describe, expect, it } from 'vitest'
// The chain's side of the blind check — test-only, same helper the api-voting
// crypto tests are anchored on.
import {
  deserializeBlindSignature,
  verify as verifyBlindSignature,
} from '../../../api-voting/src/blind-secp256k1.testkit'
import {
  MOCK_CSP_SIGNATURE,
  MOCK_WEIGHT_HEX,
  mockBatchJobs,
  mockBlindCensusKey,
  mockProcess,
} from '../../../../mocks/handlers'
import { server } from '../../../../mocks/server'
import { TestProvider } from '../test-utils'
import { ElectionProvider, PartialVoteError, useElection } from './ElectionProvider'

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <TestProvider>
      <ElectionProvider id={mockProcess.id}>{children}</ElectionProvider>
    </TestProvider>
  )
}

const useVoter = () => ({ election: useElection() })

// Same wrapper, but with a test-fast reconciliation window and job wait for
// the unknown-relay-outcome paths.
function reconcilingWrapper({ children }: { children: React.ReactNode }) {
  return (
    <TestProvider>
      <ElectionProvider
        id={mockProcess.id}
        voteOptions={{ jobTimeoutMs: 400, reconcile: { attempts: 3, intervalMs: 25 } }}
      >
        {children}
      </ElectionProvider>
    </TestProvider>
  )
}

async function connect(result: { current: ReturnType<typeof useVoter> }) {
  await act(async () => {
    await result.current.election.auth0({ memberNumber: '5' })
  })
  await act(async () => {
    await result.current.election.auth1(['123456'])
  })
}

/** Hex of the plain vote package prefix `{"nonce"` — present iff the ballot is cleartext. */
const PLAIN_PACKAGE_MARKER = '7b226e6f6e6365'

/**
 * Overrides POST /votes to capture every relayed envelope (in request order)
 * while registering the batch in mockBatchJobs, so the default batch-aware
 * jobs handler keeps resolving the job.
 */
/**
 * Counts every endpoint that consumes a one-shot CSP authorization — both the
 * plain batch sign and the anonymous flow's round 1. Spying on `/sign` alone
 * counts nothing: `vote()` has not used it since the batch sign landed, so a
 * `toBe(0)` assertion against it passes even with the pre-flight guards gone.
 */
function countSignConsumption() {
  const calls = { count: 0 }
  server.use(
    http.post(`http://localhost/processes/:processId/sign-batch`, async ({ request }) => {
      calls.count++
      const body = (await request.json()) as { ballots: Array<{ upstreamId: string }> }
      return HttpResponse.json({
        signatures: body.ballots.map((b) => ({
          upstreamId: b.upstreamId,
          signature: MOCK_CSP_SIGNATURE,
          weight: MOCK_WEIGHT_HEX,
        })),
      })
    }),
    http.post(`http://localhost/processes/:processId/blind-point`, () => {
      calls.count++
      return HttpResponse.json({ points: [] })
    }),
  )
  return calls
}

function captureBatchVotes() {
  const txPayloads: string[] = []
  server.use(
    http.post(`http://localhost/votes`, async ({ request }) => {
      const body = (await request.json()) as { votes: Array<{ txPayload: string }> }
      txPayloads.push(...body.votes.map((v) => v.txPayload))
      const jobId = `batch-job-${mockBatchJobs.size}`
      mockBatchJobs.set(jobId, body.votes.length)
      return HttpResponse.json({ jobId }, { status: 202 })
    }),
  )
  return txPayloads
}

describe('ElectionProvider', () => {
  it('starts loading then resolves the election', async () => {
    const { result } = renderHook(useVoter, { wrapper })
    expect(result.current.election.loading).toBe(true)
    await waitFor(() => expect(result.current.election.loading).toBe(false))
    expect(result.current.election.election?.id).toBe(mockProcess.id)
  })

  it('initialises with no vote and unable to vote', async () => {
    const { result } = renderHook(useVoter, { wrapper })
    await waitFor(() => expect(result.current.election.election).not.toBeNull())
    expect(result.current.election.voteId).toBeNull()
    expect(result.current.election.hasVoted).toBe(false)
    expect(result.current.election.isAbleToVote).toBe(false)
    expect(result.current.election.connected).toBe(false)
  })

  it('exposes the chainId once the process read loads', async () => {
    const { result } = renderHook(useVoter, { wrapper })
    await waitFor(() => expect(result.current.election.chainId).toBe('test'))
  })

  it('connects through the process auth flow and resolves membership + weight', async () => {
    const { result } = renderHook(useVoter, { wrapper })
    await waitFor(() => expect(result.current.election.election).not.toBeNull())

    await connect(result)

    expect(result.current.election.connected).toBe(true)
    // weight "2a" === 42, decoded from the process auth/check responses
    await waitFor(() => expect(result.current.election.weight).toBe(42))
    // membership check runs once connected — per-question state exposed
    await waitFor(() => expect(result.current.election.isInCensus).toBe(true))
    expect(result.current.election.voterQuestions).toEqual([
      {
        questionId: 'q-0',
        upstreamId: mockProcess.questions[0].upstreamId,
        canVote: true,
        hasVoted: false,
      },
    ])
    expect(result.current.election.isAbleToVote).toBe(true)
  })

  it('derives hasVoted when the check reports every question as voted', async () => {
    server.use(
      http.post(`http://localhost/processes/:processId/check`, () =>
        HttpResponse.json({
          belongsToProcess: true,
          weight: MOCK_WEIGHT_HEX,
          questions: mockProcess.questions.map((q) => ({
            questionId: q.id,
            upstreamId: q.upstreamId,
            canVote: true,
            hasVoted: true,
          })),
        }),
      ),
    )

    const { result } = renderHook(useVoter, { wrapper })
    await waitFor(() => expect(result.current.election.election).not.toBeNull())
    await connect(result)

    await waitFor(() => expect(result.current.election.hasVoted).toBe(true))
    expect(result.current.election.isInCensus).toBe(true)
    expect(result.current.election.isAbleToVote).toBe(false)
  })

  it('casts a vote and resolves the nullifier from the relay job', async () => {
    const { result } = renderHook(useVoter, { wrapper })
    await waitFor(() => expect(result.current.election.election).not.toBeNull())

    await connect(result)
    await waitFor(() => expect(result.current.election.isAbleToVote).toBe(true))

    let voteId = ''
    await act(async () => {
      voteId = await result.current.election.vote([[0]])
    })

    expect(voteId).toMatch(/^nullifier-batch-job-/)
    expect(result.current.election.voteId).toBe(voteId)
    expect(result.current.election.hasVoted).toBe(true)
    // Per-question progress reaches its terminal state.
    expect(result.current.election.voteStatus).toEqual({ 'q-0': 'confirmed' })
  })

  it('refuses to vote when the process read provides no chainId', async () => {
    // Strip chainId from the process read so the vote() guard fires.
    const { chainId: _chainId, ...processWithoutChainId } = mockProcess
    server.use(
      http.get(`http://localhost/processes/:id`, ({ params }) =>
        HttpResponse.json({ ...processWithoutChainId, id: params.id as string }),
      ),
    )
    const { result } = renderHook(useVoter, { wrapper })
    await waitFor(() => expect(result.current.election.election).not.toBeNull())
    await connect(result)
    await waitFor(() => expect(result.current.election.isAbleToVote).toBe(true))

    await expect(result.current.election.vote([[0]])).rejects.toThrow('Missing chainId')
  })

  it('refuses to vote with a ballot-count mismatch — before consuming any CSP sign', async () => {
    const { result } = renderHook(useVoter, { wrapper })
    await waitFor(() => expect(result.current.election.election).not.toBeNull())
    await connect(result)
    await waitFor(() => expect(result.current.election.isAbleToVote).toBe(true))

    // No ballots at all, and fewer ballots than questions: both must fail fast
    // (a silent `?? []` here would cast an empty ballot and half-vote the process).
    await expect(result.current.election.vote([])).rejects.toThrow('Expected one encoded ballot per question')
    expect(result.current.election.hasVoted).toBe(false)
    expect(result.current.election.voteId).toBeNull()
  })

  it('threads per-question memos onto the vote envelopes, validated pre-flight', async () => {
    const txPayloads = captureBatchVotes()

    const { result } = renderHook(useVoter, { wrapper })
    await waitFor(() => expect(result.current.election.election).not.toBeNull())
    await connect(result)
    await waitFor(() => expect(result.current.election.isAbleToVote).toBe(true))

    // An oversized memo dies before any CSP sign is consumed.
    await expect(result.current.election.vote([[0]], ['€'.repeat(100)])).rejects.toThrow('UTF-8-byte cap')
    expect(txPayloads).toHaveLength(0)

    await act(async () => {
      await result.current.election.vote([[0]], ['Other: neither'])
    })
    expect(txPayloads).toHaveLength(1)
    const signedTx = SignedTx.decode(fromHex(txPayloads[0]))
    const tx = Tx.decode(signedTx.tx)
    if (tx.payload?.$case !== 'vote') throw new Error('expected a vote payload')
    expect(new TextDecoder().decode(tx.payload.vote.memo!)).toBe('Other: neither')
  })

  it('votes an anonymous census through the blind CSP flow', async () => {
    // The whole point of the anonymous path: the CSP signs a ballot it never
    // sees. This drives it end to end against a real (fixed-key) blind signer
    // and checks the envelope the chain would receive — the proof type, and a
    // blind signature that verifies against the salted census key over the
    // bundle the transaction itself carries.
    server.use(
      http.get(`http://localhost/processes/:id`, ({ params }) =>
        HttpResponse.json({
          ...mockProcess,
          id: params.id as string,
          census: { ...mockProcess.census, anonymous: true },
        }),
      ),
    )
    const txPayloads = captureBatchVotes()

    const { result } = renderHook(useVoter, { wrapper })
    await waitFor(() => expect(result.current.election.election?.census?.anonymous).toBe(true))
    await connect(result)
    await waitFor(() => expect(result.current.election.isAbleToVote).toBe(true))

    await act(async () => {
      await result.current.election.vote([[0]])
    })

    expect(txPayloads).toHaveLength(1)
    const tx = Tx.decode(SignedTx.decode(fromHex(txPayloads[0])).tx)
    if (tx.payload?.$case !== 'vote') throw new Error('expected a vote payload')
    const proof = tx.payload.vote.proof?.payload
    if (proof?.$case !== 'ca') throw new Error('expected a CA proof')

    expect(proof.ca.type).toBe(ProofCA_Type.ECDSA_BLIND_PIDSALTED)
    const bundle = new Uint8Array(CAbundle.encode(proof.ca.bundle!).finish())
    expect(
      verifyBlindSignature(
        blindMessageFromBundle(bundle),
        deserializeBlindSignature(new Uint8Array(proof.ca.signature!)),
        mockBlindCensusKey(mockProcess.questions[0].upstreamId),
      ),
    ).toBe(true)
  })

  it('resolves per-question results from the results endpoint', async () => {
    const { result } = renderHook(useVoter, { wrapper })
    await waitFor(() => expect(result.current.election.results).not.toBeNull())
    expect(result.current.election.results?.questions).toHaveLength(1)
    expect(result.current.election.results?.questions[0].questionId).toBe('q-0')
  })

  it('treats a results 404 as "no results yet" (results stay null, no error surfaced)', async () => {
    let resultsCalls = 0
    server.use(
      http.get(`http://localhost/processes/:id/results`, () => {
        resultsCalls++
        return HttpResponse.json({ error: 'process results not found', code: 40401 }, { status: 404 })
      }),
    )

    const { result } = renderHook(useVoter, { wrapper })
    await waitFor(() => expect(result.current.election.election).not.toBeNull())

    // The results query fires once the election loads; the 404 must resolve to null.
    await waitFor(() => expect(resultsCalls).toBeGreaterThanOrEqual(1))
    // No retry hammering: the 404 resolves the query instead of erroring it.
    expect(resultsCalls).toBe(1)
    expect(result.current.election.results).toBeNull()
    expect(result.current.election.error).toBeNull()
  })

  it('signs every question in ONE call and relays every envelope in ONE batch call', async () => {
    const UPSTREAM_A = 'aa'.repeat(32)
    const UPSTREAM_B = 'bb'.repeat(32)
    const signBatches: Array<Array<{ upstreamId: string; address: string }>> = []
    const batches: Array<Array<{ txPayload: string }>> = []

    server.use(
      http.get(`http://localhost/processes/:id`, ({ params }) =>
        HttpResponse.json({
          ...mockProcess,
          id: params.id as string,
          questions: [
            { ...mockProcess.questions[0], id: 'q-0', upstreamId: UPSTREAM_A },
            {
              ...mockProcess.questions[0],
              id: 'q-1',
              upstreamId: UPSTREAM_B,
              title: { default: 'Second Question' },
            },
          ],
        }),
      ),
      http.post(`http://localhost/processes/:processId/sign-batch`, async ({ request }) => {
        const body = (await request.json()) as { ballots: Array<{ upstreamId: string; address: string }> }
        signBatches.push(body.ballots)
        return HttpResponse.json({
          signatures: body.ballots.map((b) => ({
            upstreamId: b.upstreamId,
            signature: MOCK_CSP_SIGNATURE,
            weight: MOCK_WEIGHT_HEX,
          })),
        })
      }),
      http.post(`http://localhost/votes`, async ({ request }) => {
        const body = (await request.json()) as { votes: Array<{ txPayload: string }> }
        batches.push(body.votes)
        const jobId = `batch-job-${mockBatchJobs.size}`
        mockBatchJobs.set(jobId, body.votes.length)
        return HttpResponse.json({ jobId }, { status: 202 })
      }),
    )

    const { result } = renderHook(useVoter, { wrapper })
    await waitFor(() => expect(result.current.election.election).not.toBeNull())
    await connect(result)
    await waitFor(() => expect(result.current.election.isAbleToVote).toBe(true))

    let voteId = ''
    await act(async () => {
      voteId = await result.current.election.vote([[0], [1]])
    })

    // ONE sign call carrying both questions, keyed by upstreamId, in order
    expect(signBatches).toHaveLength(1)
    expect(signBatches[0].map((b) => b.upstreamId)).toEqual([UPSTREAM_A, UPSTREAM_B])

    // a fresh ephemeral signer per question: two distinct addresses were signed
    expect(signBatches[0][0].address).toMatch(/^0x[0-9a-f]{40}$/i)
    expect(signBatches[0][1].address).toMatch(/^0x[0-9a-f]{40}$/i)
    expect(signBatches[0][0].address).not.toBe(signBatches[0][1].address)

    // ONE relay call carrying both envelopes, in question order
    expect(batches).toHaveLength(1)
    expect(batches[0]).toHaveLength(2)

    // the returned vote id is the FIRST question's vote id, per-question state terminal
    expect(voteId).toBe('nullifier-batch-job-0-0')
    expect(result.current.election.voteId).toBe('nullifier-batch-job-0-0')
    expect(result.current.election.voteStatus).toEqual({ 'q-0': 'confirmed', 'q-1': 'confirmed' })
    // …and EVERY question's vote id is exposed, not just the first.
    expect(result.current.election.voteIds).toEqual({
      'q-0': 'nullifier-batch-job-0-0',
      'q-1': 'nullifier-batch-job-0-1',
    })
  })

  it('recovers every vote id from sign-info when a voted voter connects', async () => {
    const UPSTREAM_A = 'aa'.repeat(32)
    const UPSTREAM_B = 'bb'.repeat(32)
    let signInfoCalls = 0
    server.use(
      http.get(`http://localhost/processes/:id`, ({ params }) =>
        HttpResponse.json({
          ...mockProcess,
          id: params.id as string,
          questions: [
            { ...mockProcess.questions[0], id: 'q-0', upstreamId: UPSTREAM_A },
            { ...mockProcess.questions[0], id: 'q-1', upstreamId: UPSTREAM_B },
          ],
        }),
      ),
      http.post(`http://localhost/processes/:processId/check`, () =>
        HttpResponse.json({
          belongsToProcess: true,
          weight: MOCK_WEIGHT_HEX,
          questions: [
            { questionId: 'q-0', upstreamId: UPSTREAM_A, canVote: false, hasVoted: true },
            { questionId: 'q-1', upstreamId: UPSTREAM_B, canVote: false, hasVoted: true },
          ],
        }),
      ),
      http.post(`http://localhost/processes/:processId/sign-info`, () => {
        signInfoCalls++
        return HttpResponse.json({
          consumed: [
            { questionId: 'q-0', upstreamId: UPSTREAM_A, address: '0xa', nullifier: 'null-a', at: '2024-01-01T00:00:00Z' },
            { questionId: 'q-1', upstreamId: UPSTREAM_B, address: '0xb', nullifier: 'null-b', at: '2024-01-01T00:00:00Z' },
          ],
        })
      }),
    )

    const { result } = renderHook(useVoter, { wrapper })
    await waitFor(() => expect(result.current.election.election).not.toBeNull())
    await connect(result)

    // A returning voter never called vote() in this session, yet holds both ids.
    await waitFor(() =>
      expect(result.current.election.voteIds).toEqual({ 'q-0': 'null-a', 'q-1': 'null-b' }),
    )
    expect(signInfoCalls).toBe(1)
    // The legacy single field is seeded too, instead of staying empty on reload.
    expect(result.current.election.voteId).toBe('null-a')
  })

  it('skips the sign-info recovery when the voter has voted nothing', async () => {
    let signInfoCalls = 0
    server.use(
      http.post(`http://localhost/processes/:processId/sign-info`, () => {
        signInfoCalls++
        return HttpResponse.json({ consumed: [] })
      }),
    )

    const { result } = renderHook(useVoter, { wrapper })
    await waitFor(() => expect(result.current.election.election).not.toBeNull())
    await connect(result)
    await waitFor(() => expect(result.current.election.isAbleToVote).toBe(true))

    expect(signInfoCalls).toBe(0)
    expect(result.current.election.voteIds).toEqual({})
  })

  it('keeps membership when the sign-info recovery fails', async () => {
    server.use(
      http.post(`http://localhost/processes/:processId/check`, () =>
        HttpResponse.json({
          belongsToProcess: true,
          weight: MOCK_WEIGHT_HEX,
          questions: mockProcess.questions.map((q) => ({
            questionId: q.id,
            upstreamId: q.upstreamId,
            canVote: false,
            hasVoted: true,
          })),
        }),
      ),
      http.post(`http://localhost/processes/:processId/sign-info`, () =>
        HttpResponse.json({ error: 'sign-info is down' }, { status: 500 }),
      ),
    )

    const { result } = renderHook(useVoter, { wrapper })
    await waitFor(() => expect(result.current.election.election).not.toBeNull())
    await connect(result)

    await waitFor(() => expect(result.current.election.hasVoted).toBe(true))
    expect(result.current.election.isInCensus).toBe(true)
    expect(result.current.election.voteIds).toEqual({})
  })

  it('refuses to cast a cleartext ballot for a secret question without published keys', async () => {
    server.use(
      http.get(`http://localhost/processes/:id`, ({ params }) =>
        HttpResponse.json({
          ...mockProcess,
          id: params.id as string,
          questions: [{ ...mockProcess.questions[0], secretUntilTheEnd: true }],
        }),
      ),
    )
    const signCalls = countSignConsumption()

    const { result } = renderHook(useVoter, { wrapper })
    await waitFor(() => expect(result.current.election.election).not.toBeNull())
    await connect(result)
    await waitFor(() => expect(result.current.election.isAbleToVote).toBe(true))

    await expect(result.current.election.vote([[0]])).rejects.toThrow(
      /encryption keys are not published yet/,
    )
    // The guard fires BEFORE the one-shot CSP sign gets consumed.
    expect(signCalls.count).toBe(0)
    expect(result.current.election.hasVoted).toBe(false)
  })

  it('passes the encryption keys through — secret ballots go out sealed', async () => {
    const UPSTREAM_A = 'aa'.repeat(32)
    const UPSTREAM_B = 'bb'.repeat(32)

    server.use(
      http.get(`http://localhost/processes/:id`, ({ params }) =>
        HttpResponse.json({
          ...mockProcess,
          id: params.id as string,
          questions: [
            { ...mockProcess.questions[0], id: 'q-0', upstreamId: UPSTREAM_A },
            {
              ...mockProcess.questions[0],
              id: 'q-1',
              upstreamId: UPSTREAM_B,
              secretUntilTheEnd: true,
              // Any 32-byte curve25519 public key seals fine — we only assert
              // the package went out encrypted, never decrypt it.
              encryptionKeys: [{ index: 0, key: 'cd'.repeat(32) }],
            },
          ],
        }),
      ),
    )
    const txPayloads = captureBatchVotes()

    const { result } = renderHook(useVoter, { wrapper })
    await waitFor(() => expect(result.current.election.election).not.toBeNull())
    await connect(result)
    await waitFor(() => expect(result.current.election.isAbleToVote).toBe(true))

    await act(async () => {
      await result.current.election.vote([[0], [1]])
    })

    expect(txPayloads).toHaveLength(2)
    // The plain question's package is cleartext JSON ({"nonce"…)…
    expect(txPayloads[0]).toContain(PLAIN_PACKAGE_MARKER)
    // …the secret question's package is sealed — no cleartext JSON in the wire.
    expect(txPayloads[1]).not.toContain(PLAIN_PACKAGE_MARKER)
  })

  it('pre-flights every question before consuming any CSP sign (no partial cast)', async () => {
    // Question 1 is secret without published keys. The old per-question loop
    // would cast question 0 first and only then hit the guard, half-voting the
    // process; the pre-flight must fire before ANY sign or relay.
    server.use(
      http.get(`http://localhost/processes/:id`, ({ params }) =>
        HttpResponse.json({
          ...mockProcess,
          id: params.id as string,
          questions: [
            { ...mockProcess.questions[0], id: 'q-0', upstreamId: 'aa'.repeat(32) },
            {
              ...mockProcess.questions[0],
              id: 'q-1',
              upstreamId: 'bb'.repeat(32),
              secretUntilTheEnd: true,
            },
          ],
        }),
      ),
    )
    const signCalls = countSignConsumption()
    const relayed = captureBatchVotes()

    const { result } = renderHook(useVoter, { wrapper })
    await waitFor(() => expect(result.current.election.election).not.toBeNull())
    await connect(result)
    await waitFor(() => expect(result.current.election.isAbleToVote).toBe(true))

    await expect(result.current.election.vote([[0], [1]])).rejects.toThrow(
      /encryption keys are not published yet/,
    )
    expect(signCalls.count).toBe(0)
    expect(relayed).toHaveLength(0)
    expect(result.current.election.hasVoted).toBe(false)
  })

  it('relays the questions that did sign when the CSP refuses one of them', async () => {
    let signCalls = 0
    server.use(
      http.get(`http://localhost/processes/:id`, ({ params }) =>
        HttpResponse.json({
          ...mockProcess,
          id: params.id as string,
          questions: [
            { ...mockProcess.questions[0], id: 'q-0', upstreamId: 'aa'.repeat(32) },
            { ...mockProcess.questions[0], id: 'q-1', upstreamId: 'bb'.repeat(32) },
          ],
        }),
      ),
      http.post(`http://localhost/processes/:processId/sign-batch`, async ({ request }) => {
        signCalls++
        const body = (await request.json()) as { ballots: Array<{ upstreamId: string }> }
        // First question signs, second is refused inline. That signature is
        // one-shot and already spent — dropping it would strand q-0 forever.
        return HttpResponse.json({
          signatures: body.ballots.map((b, i) =>
            i === 0
              ? { upstreamId: b.upstreamId, signature: MOCK_CSP_SIGNATURE, weight: MOCK_WEIGHT_HEX }
              : { upstreamId: b.upstreamId, code: 'sign_failed', error: 'csp down' },
          ),
        })
      }),
    )
    const relayed = captureBatchVotes()

    const { result } = renderHook(useVoter, { wrapper })
    await waitFor(() => expect(result.current.election.election).not.toBeNull())
    await connect(result)
    await waitFor(() => expect(result.current.election.isAbleToVote).toBe(true))

    const err = await result.current.election.vote([[0], [1]]).catch((e) => e)
    expect(err).toBeInstanceOf(PartialVoteError)
    expect(err.succeeded.map((s: { questionId: string }) => s.questionId)).toEqual(['q-0'])
    expect(err.failed.map((f: { questionId: string }) => f.questionId)).toEqual(['q-1'])
    expect(signCalls).toBe(1)
    // q-0's spent signature went on chain rather than being thrown away.
    expect(relayed).toHaveLength(1)
    expect(result.current.election.hasVoted).toBe(false)
  })

  it('is a plain retryable error when the CSP signs nothing at all', async () => {
    server.use(
      http.post(`http://localhost/processes/:processId/sign-batch`, async ({ request }) => {
        const body = (await request.json()) as { ballots: Array<{ upstreamId: string }> }
        return HttpResponse.json({
          signatures: body.ballots.map((b) => ({ upstreamId: b.upstreamId, code: 'sign_failed', error: 'csp down' })),
        })
      }),
    )
    const relayed = captureBatchVotes()

    const { result } = renderHook(useVoter, { wrapper })
    await waitFor(() => expect(result.current.election.election).not.toBeNull())
    await connect(result)
    await waitFor(() => expect(result.current.election.isAbleToVote).toBe(true))

    // Nothing was consumed that a retry can't consume again, so there is no
    // partial state to report — and no empty batch to relay.
    const err = await result.current.election.vote([[0]]).catch((e) => e)
    expect(err).not.toBeInstanceOf(PartialVoteError)
    expect(err.message).toMatch(/did not sign/)
    expect(relayed).toHaveLength(0)
  })

  it('resumes a half-voted process: skips questions the check reports as voted', async () => {
    const UPSTREAM_A = 'aa'.repeat(32)
    const UPSTREAM_B = 'bb'.repeat(32)
    const signBodies: Array<{ upstreamId: string }> = []
    server.use(
      http.get(`http://localhost/processes/:id`, ({ params }) =>
        HttpResponse.json({
          ...mockProcess,
          id: params.id as string,
          questions: [
            { ...mockProcess.questions[0], id: 'q-0', upstreamId: UPSTREAM_A },
            { ...mockProcess.questions[0], id: 'q-1', upstreamId: UPSTREAM_B },
          ],
        }),
      ),
      // The voter already voted q-0 (e.g. a previous vote() died after casting it).
      http.post(`http://localhost/processes/:processId/check`, () =>
        HttpResponse.json({
          belongsToProcess: true,
          weight: MOCK_WEIGHT_HEX,
          questions: [
            { questionId: 'q-0', upstreamId: UPSTREAM_A, canVote: false, hasVoted: true },
            { questionId: 'q-1', upstreamId: UPSTREAM_B, canVote: true, hasVoted: false },
          ],
        }),
      ),
      http.post(`http://localhost/processes/:processId/sign-batch`, async ({ request }) => {
        const body = (await request.json()) as { ballots: Array<{ upstreamId: string }> }
        signBodies.push(...body.ballots)
        return HttpResponse.json({
          signatures: body.ballots.map((b) => ({
            upstreamId: b.upstreamId,
            signature: MOCK_CSP_SIGNATURE,
            weight: MOCK_WEIGHT_HEX,
          })),
        })
      }),
    )

    const { result } = renderHook(useVoter, { wrapper })
    await waitFor(() => expect(result.current.election.election).not.toBeNull())
    await connect(result)
    await waitFor(() => expect(result.current.election.isInCensus).toBe(true))

    let voteId = ''
    await act(async () => {
      voteId = await result.current.election.vote([[0], [1]])
    })

    // Only q-1 was signed and cast; the resumed call completes the process.
    expect(signBodies.map((b) => b.upstreamId)).toEqual([UPSTREAM_B])
    expect(voteId).toMatch(/^nullifier-batch-job-/)
    expect(result.current.election.hasVoted).toBe(true)
    // The skipped question reads as confirmed too — it is on chain already.
    expect(result.current.election.voteStatus).toEqual({ 'q-0': 'confirmed', 'q-1': 'confirmed' })
  })

  it('surfaces a PartialVoteError from the batch job per-vote outcomes', async () => {
    const UPSTREAM_A = 'aa'.repeat(32)
    const UPSTREAM_B = 'bb'.repeat(32)
    server.use(
      http.get(`http://localhost/processes/:id`, ({ params }) =>
        HttpResponse.json({
          ...mockProcess,
          id: params.id as string,
          questions: [
            { ...mockProcess.questions[0], id: 'q-0', upstreamId: UPSTREAM_A },
            { ...mockProcess.questions[0], id: 'q-1', upstreamId: UPSTREAM_B },
          ],
        }),
      ),
      http.post(`http://localhost/processes/:processId/sign`, () =>
        HttpResponse.json({ signature: MOCK_CSP_SIGNATURE, weight: MOCK_WEIGHT_HEX }),
      ),
      // The batch is ACCEPTED (both envelopes enqueued)…
      http.post(`http://localhost/votes`, () =>
        HttpResponse.json({ jobId: 'batch-job-partial' }, { status: 202 }),
      ),
      // …but on chain q-0 lands and q-1 fails: the job ends FAILED and its
      // per-vote outcomes carry the truth for both envelopes.
      http.get(`http://localhost/jobs/:jobId`, ({ params }) =>
        HttpResponse.json({
          jobId: params.jobId as string,
          status: 'failed',
          type: 'relay_votes',
          errors: ['1/2 votes failed'],
          result: {
            votes: [
              { processId: UPSTREAM_A, nullifier: 'null-0', status: 'completed', voteID: 'nullifier-job-0' },
              { processId: UPSTREAM_B, nullifier: 'null-1', status: 'failed', error: 'tx dropped by chain' },
            ],
          },
        }),
      ),
    )

    const { result } = renderHook(useVoter, { wrapper })
    await waitFor(() => expect(result.current.election.election).not.toBeNull())
    await connect(result)
    await waitFor(() => expect(result.current.election.isAbleToVote).toBe(true))

    let thrown: unknown
    await act(async () => {
      thrown = await result.current.election.vote([[0], [1]]).catch((err) => err)
    })

    expect(thrown).toBeInstanceOf(PartialVoteError)
    const partial = thrown as PartialVoteError
    expect(partial.succeeded).toEqual([{ questionId: 'q-0', voteId: 'nullifier-job-0' }])
    expect(partial.failed).toHaveLength(1)
    expect(partial.failed[0].questionId).toBe('q-1')
    expect((partial.failed[0].error as Error).message).toBe('tx dropped by chain')
    // voteStatus mirrors the per-envelope truth.
    expect(result.current.election.voteStatus).toEqual({ 'q-0': 'confirmed', 'q-1': 'failed' })
    // The id that DID land is exposed — a partial cast must not lose it.
    expect(result.current.election.voteIds).toEqual({ 'q-0': 'nullifier-job-0' })
    expect(result.current.election.voteId).toBe('nullifier-job-0')
  })

  it('a synchronously rejected batch is a plain retryable error — zero votes, no PartialVoteError', async () => {
    let jobPolls = 0
    server.use(
      // Queue full: the batch is rejected AS A UNIT, nothing was enqueued.
      http.post(`http://localhost/votes`, () =>
        HttpResponse.json({ error: 'transaction queue is full' }, { status: 503 }),
      ),
      http.get(`http://localhost/jobs/:jobId`, () => {
        jobPolls++
        return HttpResponse.json({}, { status: 404 })
      }),
    )

    const { result } = renderHook(useVoter, { wrapper })
    await waitFor(() => expect(result.current.election.election).not.toBeNull())
    await connect(result)
    await waitFor(() => expect(result.current.election.isAbleToVote).toBe(true))

    let thrown: unknown
    await act(async () => {
      thrown = await result.current.election.vote([[0]]).catch((err) => err)
    })

    expect(thrown).not.toBeInstanceOf(PartialVoteError)
    expect(thrown).toBeInstanceOf(Error)
    // No job was created, so nothing was polled; nothing is voted.
    expect(jobPolls).toBe(0)
    expect(result.current.election.hasVoted).toBe(false)
    expect(result.current.election.voteStatus).toEqual({ 'q-0': 'failed' })
  })

  it('refuses to cast more than the batch cap in one call — before any CSP sign', async () => {
    server.use(
      http.get(`http://localhost/processes/:id`, ({ params }) =>
        HttpResponse.json({
          ...mockProcess,
          id: params.id as string,
          questions: Array.from({ length: 101 }, (_, i) => ({
            ...mockProcess.questions[0],
            id: `q-${i}`,
            upstreamId: `${i.toString(16).padStart(2, '0')}`.repeat(32),
          })),
        }),
      ),
    )
    const signCalls = countSignConsumption()

    const { result } = renderHook(useVoter, { wrapper })
    await waitFor(() => expect(result.current.election.election).not.toBeNull())
    await connect(result)
    await waitFor(() => expect(result.current.election.isInCensus).toBe(true))

    const ballots = Array.from({ length: 101 }, () => [0])
    await expect(result.current.election.vote(ballots)).rejects.toThrow('caps at 100')
    expect(signCalls.count).toBe(0)
  })

  it('renders a prefetched election immediately and still refetches by its id', async () => {
    let fetchCalls = 0
    server.use(
      http.get(`http://localhost/processes/:id`, ({ params }) => {
        fetchCalls++
        return HttpResponse.json({
          ...mockProcess,
          id: params.id as string,
          title: { default: 'Fresh title' },
        })
      }),
    )

    const prefetched = {
      ...mockProcess,
      title: { default: 'Prefetched title' },
    } as VotingProcessResponse

    // No `id` prop at all: the provider must derive it from `election.id`.
    const { result } = renderHook(useElection, {
      wrapper: ({ children }) => (
        <TestProvider>
          <ElectionProvider election={prefetched}>{children}</ElectionProvider>
        </TestProvider>
      ),
    })

    // The prefetched data is available synchronously — no loading flash.
    expect(result.current.loading).toBe(false)
    expect(result.current.election?.title).toEqual({ default: 'Prefetched title' })
    // initialData is immediately stale (staleTime 0), so it refetches on mount.
    await waitFor(() => expect(result.current.election?.title).toEqual({ default: 'Fresh title' }))
    expect(fetchCalls).toBe(1)
  })

  it('with both election and id, seeds the prefetched data under the id and refetches', async () => {
    let fetchCalls = 0
    server.use(
      http.get(`http://localhost/processes/:id`, ({ params }) => {
        fetchCalls++
        return HttpResponse.json({
          ...mockProcess,
          id: params.id as string,
          title: { default: 'Fresh title' },
        })
      }),
    )

    const prefetched = {
      ...mockProcess,
      title: { default: 'Prefetched title' },
    } as VotingProcessResponse

    const { result } = renderHook(useElection, {
      wrapper: ({ children }) => (
        <TestProvider>
          <ElectionProvider id={mockProcess.id} election={prefetched}>
            {children}
          </ElectionProvider>
        </TestProvider>
      ),
    })

    expect(result.current.loading).toBe(false)
    expect(result.current.election?.title).toEqual({ default: 'Prefetched title' })
    await waitFor(() => expect(result.current.election?.title).toEqual({ default: 'Fresh title' }))
    expect(fetchCalls).toBe(1)
  })

  it('normalizes a prefetched election, so extended choice info shows on the first paint', async () => {
    // Raw wire data: extended choice info lives on the question, and the live
    // status arrives under its wire name.
    const prefetched = {
      ...mockProcess,
      questions: [
        {
          ...mockProcess.questions[0],
          status: 'READY',
          choices: [
            { title: { default: 'With skin' }, value: 0 },
            { title: { default: 'Without skin' }, value: 1 },
          ],
          metadata: {
            choices: [{ value: 0, description: 'Unpeeled', image: 'https://cdn.example/a.jpeg' }],
          },
        },
      ],
    } as unknown as VotingProcessResponse

    const { result } = renderHook(useElection, {
      wrapper: ({ children }) => (
        <TestProvider>
          <ElectionProvider election={prefetched}>{children}</ElectionProvider>
        </TestProvider>
      ),
    })

    // Synchronously, before any refetch lands.
    expect(result.current.loading).toBe(false)
    expect(result.current.election?.questions[0].choices[0].meta).toEqual({
      description: 'Unpeeled',
      image: { default: 'https://cdn.example/a.jpeg' },
    })
    expect(result.current.election?.questions[0].choices[1].meta).toBeUndefined()
    expect(result.current.status).toBe('ONGOING')
  })

  it('carries extended choice info through the fetched election, refetch included', async () => {
    server.use(
      http.get(`http://localhost/processes/:id`, ({ params }) =>
        HttpResponse.json({
          ...mockProcess,
          id: params.id as string,
          questions: [
            {
              ...mockProcess.questions[0],
              choices: [{ title: { default: 'With skin' }, value: 0 }],
              metadata: { choices: [{ value: 0, image: 'https://cdn.example/a.jpeg' }] },
            },
          ],
        }),
      ),
    )

    const { result } = renderHook(useElection, { wrapper })
    await waitFor(() => expect(result.current.election).not.toBeNull())
    expect(result.current.election?.questions[0].choices[0].meta?.image).toEqual({
      default: 'https://cdn.example/a.jpeg',
    })
  })

  it('ignores a prefetched election whose id mismatches the id prop', async () => {
    const prefetched = {
      ...mockProcess,
      id: 'someOtherProcess',
      title: { default: 'Wrong election' },
    } as VotingProcessResponse

    const { result } = renderHook(useElection, {
      wrapper: ({ children }) => (
        <TestProvider>
          <ElectionProvider id={mockProcess.id} election={prefetched}>
            {children}
          </ElectionProvider>
        </TestProvider>
      ),
    })

    // The mismatched data must never be shown under `id`'s cache entry.
    expect(result.current.election?.title).not.toEqual({ default: 'Wrong election' })
    await waitFor(() => expect(result.current.election).not.toBeNull())
    expect(result.current.election?.id).toBe(mockProcess.id)
    expect(result.current.election?.title).toEqual({ default: 'Test Process' })
  })

  it('exposes voting=true while vote() is in flight and false once it settles', async () => {
    // Slow the relay down so the in-flight state is observable.
    server.use(
      http.post(`http://localhost/votes`, async ({ request }) => {
        const body = (await request.json()) as { votes: Array<{ txPayload: string }> }
        await new Promise((r) => setTimeout(r, 100))
        const jobId = `batch-job-${mockBatchJobs.size}`
        mockBatchJobs.set(jobId, body.votes.length)
        return HttpResponse.json({ jobId }, { status: 202 })
      }),
    )

    const { result } = renderHook(useVoter, { wrapper })
    await waitFor(() => expect(result.current.election.election).not.toBeNull())
    await connect(result)
    await waitFor(() => expect(result.current.election.isAbleToVote).toBe(true))
    expect(result.current.election.voting).toBe(false)

    let pending!: Promise<string>
    act(() => {
      pending = result.current.election.vote([[0]])
    })
    await waitFor(() => expect(result.current.election.voting).toBe(true))

    await act(async () => {
      await pending
    })
    expect(result.current.election.voting).toBe(false)
    expect(result.current.election.hasVoted).toBe(true)
  })

  it('clears voting when vote() throws', async () => {
    const { result } = renderHook(useVoter, { wrapper })
    await waitFor(() => expect(result.current.election.election).not.toBeNull())
    await connect(result)
    await waitFor(() => expect(result.current.election.isAbleToVote).toBe(true))

    // Ballot-count mismatch rejects in pre-flight — voting must still reset.
    await act(async () => {
      await expect(result.current.election.vote([])).rejects.toThrow(
        'Expected one encoded ballot per question',
      )
    })
    expect(result.current.election.voting).toBe(false)
  })

  it('threads queryOptions and resultsQueryOptions through to react-query', async () => {
    let electionCalls = 0
    let resultsCalls = 0
    server.use(
      http.get(`http://localhost/processes/:id`, ({ params }) => {
        electionCalls++
        return HttpResponse.json({ ...mockProcess, id: params.id as string })
      }),
      http.get(`http://localhost/processes/:id/results`, () => {
        resultsCalls++
        return HttpResponse.json({ processId: mockProcess.id, questions: [] })
      }),
    )

    const { result, unmount } = renderHook(useElection, {
      wrapper: ({ children }) => (
        <TestProvider>
          <ElectionProvider
            id={mockProcess.id}
            queryOptions={{ refetchInterval: 30 }}
            resultsQueryOptions={{ refetchInterval: 30 }}
          >
            {children}
          </ElectionProvider>
        </TestProvider>
      ),
    })

    await waitFor(() => expect(result.current.election).not.toBeNull())
    // refetchInterval keeps both reads polling independently.
    await waitFor(() => expect(electionCalls).toBeGreaterThanOrEqual(2))
    await waitFor(() => expect(resultsCalls).toBeGreaterThanOrEqual(2))
    unmount()
  })

  it('reconciles a lost relay response against the voter state instead of reporting failure', async () => {
    // The POST /votes response is lost at the network level AFTER the backend
    // accepted and enqueued the batch: the votes land on chain, but the client
    // never learns the jobId. The provider must reconcile through check() +
    // sign-info before declaring failure.
    let relayReached = false
    server.use(
      http.post(`http://localhost/votes`, () => {
        relayReached = true
        return HttpResponse.error()
      }),
      http.post(`http://localhost/processes/:processId/check`, () =>
        HttpResponse.json({
          belongsToProcess: true,
          weight: MOCK_WEIGHT_HEX,
          questions: mockProcess.questions.map((q) => ({
            questionId: q.id,
            upstreamId: q.upstreamId,
            canVote: true,
            hasVoted: relayReached,
          })),
        }),
      ),
      http.post(`http://localhost/processes/:processId/sign-info`, () =>
        HttpResponse.json({
          consumed: relayReached
            ? mockProcess.questions.map((q) => ({ questionId: q.id, nullifier: `reconciled-${q.id}` }))
            : [],
        }),
      ),
    )

    const { result } = renderHook(useVoter, { wrapper: reconcilingWrapper })
    await waitFor(() => expect(result.current.election.election).not.toBeNull())
    await connect(result)
    await waitFor(() => expect(result.current.election.isAbleToVote).toBe(true))

    let voteId = ''
    await act(async () => {
      voteId = await result.current.election.vote([[0]])
    })

    expect(voteId).toBe('reconciled-q-0')
    expect(result.current.election.voteStatus).toEqual({ 'q-0': 'confirmed' })
    expect(result.current.election.voteIds).toEqual({ 'q-0': 'reconciled-q-0' })
    expect(result.current.election.hasVoted).toBe(true)
  })

  it('reports failure when the lost-relay reconciliation window closes with nothing on chain', async () => {
    // Network error AND the backend really never enqueued anything: after the
    // bounded reconciliation window the original error surfaces and every
    // question is truthfully failed.
    let checkPolls = 0
    server.use(
      http.post(`http://localhost/votes`, () => HttpResponse.error()),
      http.post(`http://localhost/processes/:processId/check`, () => {
        checkPolls++
        return HttpResponse.json({
          belongsToProcess: true,
          weight: MOCK_WEIGHT_HEX,
          questions: mockProcess.questions.map((q) => ({
            questionId: q.id,
            upstreamId: q.upstreamId,
            canVote: true,
            hasVoted: false,
          })),
        })
      }),
    )

    const { result } = renderHook(useVoter, { wrapper: reconcilingWrapper })
    await waitFor(() => expect(result.current.election.election).not.toBeNull())
    await connect(result)
    await waitFor(() => expect(result.current.election.isAbleToVote).toBe(true))

    const before = checkPolls
    let thrown: unknown
    await act(async () => {
      thrown = await result.current.election.vote([[0]]).catch((err) => err)
    })

    expect(thrown).toBeInstanceOf(Error)
    expect(thrown).not.toBeInstanceOf(PartialVoteError)
    expect(result.current.election.voteStatus).toEqual({ 'q-0': 'failed' })
    expect(result.current.election.hasVoted).toBe(false)
    // The window was actually used: pre-flight check + the reconcile polls.
    expect(checkPolls - before).toBe(1 + 3)
  })

  it('reconciles a partially landed batch after a lost relay response into a PartialVoteError', async () => {
    const UPSTREAM_A = 'aa'.repeat(32)
    const UPSTREAM_B = 'bb'.repeat(32)
    let relayReached = false
    server.use(
      http.get(`http://localhost/processes/:id`, ({ params }) =>
        HttpResponse.json({
          ...mockProcess,
          id: params.id as string,
          questions: [
            { ...mockProcess.questions[0], id: 'q-0', upstreamId: UPSTREAM_A },
            { ...mockProcess.questions[0], id: 'q-1', upstreamId: UPSTREAM_B },
          ],
        }),
      ),
      http.post(`http://localhost/processes/:processId/sign`, () =>
        HttpResponse.json({ signature: MOCK_CSP_SIGNATURE, weight: MOCK_WEIGHT_HEX }),
      ),
      http.post(`http://localhost/votes`, () => {
        relayReached = true
        return HttpResponse.error()
      }),
      // Only q-0 ever lands on chain.
      http.post(`http://localhost/processes/:processId/check`, () =>
        HttpResponse.json({
          belongsToProcess: true,
          weight: MOCK_WEIGHT_HEX,
          questions: [
            { questionId: 'q-0', upstreamId: UPSTREAM_A, canVote: true, hasVoted: relayReached },
            { questionId: 'q-1', upstreamId: UPSTREAM_B, canVote: true, hasVoted: false },
          ],
        }),
      ),
      http.post(`http://localhost/processes/:processId/sign-info`, () =>
        HttpResponse.json({
          consumed: relayReached ? [{ questionId: 'q-0', nullifier: 'reconciled-q-0' }] : [],
        }),
      ),
    )

    const { result } = renderHook(useVoter, { wrapper: reconcilingWrapper })
    await waitFor(() => expect(result.current.election.election).not.toBeNull())
    await connect(result)
    await waitFor(() => expect(result.current.election.isAbleToVote).toBe(true))

    let thrown: unknown
    await act(async () => {
      thrown = await result.current.election.vote([[0], [1]]).catch((err) => err)
    })

    expect(thrown).toBeInstanceOf(PartialVoteError)
    const partial = thrown as PartialVoteError
    expect(partial.succeeded).toEqual([{ questionId: 'q-0', voteId: 'reconciled-q-0' }])
    expect(partial.failed.map((f) => f.questionId)).toEqual(['q-1'])
    expect(result.current.election.voteStatus).toEqual({ 'q-0': 'confirmed', 'q-1': 'failed' })
    expect(result.current.election.voteIds).toEqual({ 'q-0': 'reconciled-q-0' })
  })

  it('exonerates a job-reported envelope failure when the vote is actually on chain', async () => {
    // The relay job reports q-1 failed ("nullifier already exists" — e.g. a
    // duplicate relay), but the voter state proves the vote IS on chain. The
    // job verdict must be reconciled against check() before surfacing failure.
    const UPSTREAM_A = 'aa'.repeat(32)
    const UPSTREAM_B = 'bb'.repeat(32)
    let relayReached = false
    server.use(
      http.get(`http://localhost/processes/:id`, ({ params }) =>
        HttpResponse.json({
          ...mockProcess,
          id: params.id as string,
          questions: [
            { ...mockProcess.questions[0], id: 'q-0', upstreamId: UPSTREAM_A },
            { ...mockProcess.questions[0], id: 'q-1', upstreamId: UPSTREAM_B },
          ],
        }),
      ),
      http.post(`http://localhost/processes/:processId/sign`, () =>
        HttpResponse.json({ signature: MOCK_CSP_SIGNATURE, weight: MOCK_WEIGHT_HEX }),
      ),
      http.post(`http://localhost/votes`, () => {
        relayReached = true
        return HttpResponse.json({ jobId: 'batch-job-exonerate' }, { status: 202 })
      }),
      http.get(`http://localhost/jobs/:jobId`, ({ params }) =>
        HttpResponse.json({
          jobId: params.jobId as string,
          status: 'failed',
          type: 'relay_votes',
          errors: ['1/2 votes failed'],
          result: {
            votes: [
              { processId: UPSTREAM_A, nullifier: 'null-0', status: 'completed', voteID: 'nullifier-job-0' },
              { processId: UPSTREAM_B, nullifier: 'null-1', status: 'failed', error: 'nullifier already exists' },
            ],
          },
        }),
      ),
      // The voter state tells the truth: once the relay ran, BOTH votes are on
      // chain, whatever the job verdict says.
      http.post(`http://localhost/processes/:processId/check`, () =>
        HttpResponse.json({
          belongsToProcess: true,
          weight: MOCK_WEIGHT_HEX,
          questions: [
            { questionId: 'q-0', upstreamId: UPSTREAM_A, canVote: true, hasVoted: relayReached },
            { questionId: 'q-1', upstreamId: UPSTREAM_B, canVote: true, hasVoted: relayReached },
          ],
        }),
      ),
      http.post(`http://localhost/processes/:processId/sign-info`, () =>
        HttpResponse.json({
          consumed: relayReached
            ? [
                { questionId: 'q-0', nullifier: 'nullifier-job-0' },
                { questionId: 'q-1', nullifier: 'nullifier-job-1' },
              ]
            : [],
        }),
      ),
    )

    const { result } = renderHook(useVoter, { wrapper: reconcilingWrapper })
    await waitFor(() => expect(result.current.election.election).not.toBeNull())
    await connect(result)
    await waitFor(() => expect(result.current.election.isAbleToVote).toBe(true))

    let voteId = ''
    await act(async () => {
      voteId = await result.current.election.vote([[0], [1]])
    })

    expect(voteId).toBe('nullifier-job-0')
    expect(result.current.election.voteStatus).toEqual({ 'q-0': 'confirmed', 'q-1': 'confirmed' })
    expect(result.current.election.voteIds).toEqual({ 'q-0': 'nullifier-job-0', 'q-1': 'nullifier-job-1' })
    expect(result.current.election.hasVoted).toBe(true)
  })

  it('refuses a second vote() while the first is still being relayed', async () => {
    let signCalls = 0
    server.use(
      http.post(`http://localhost/processes/:processId/sign-batch`, async ({ request }) => {
        signCalls++
        const body = (await request.json()) as { ballots: Array<{ upstreamId: string }> }
        return HttpResponse.json({
          signatures: body.ballots.map((b) => ({
            upstreamId: b.upstreamId,
            signature: MOCK_CSP_SIGNATURE,
            weight: MOCK_WEIGHT_HEX,
          })),
        })
      }),
      // Slow relay: the first vote stays in flight long enough to overlap.
      http.post(`http://localhost/votes`, async ({ request }) => {
        const body = (await request.json()) as { votes: Array<{ txPayload: string }> }
        await new Promise((r) => setTimeout(r, 150))
        const jobId = `batch-job-${mockBatchJobs.size}`
        mockBatchJobs.set(jobId, body.votes.length)
        return HttpResponse.json({ jobId }, { status: 202 })
      }),
    )

    const { result } = renderHook(useVoter, { wrapper })
    await waitFor(() => expect(result.current.election.election).not.toBeNull())
    await connect(result)
    await waitFor(() => expect(result.current.election.isAbleToVote).toBe(true))

    let first!: Promise<string>
    act(() => {
      first = result.current.election.vote([[0]])
    })

    // Overlapping call: refused outright — it must not re-sign or re-relay,
    // which would race the in-flight batch with a fresh ephemeral signer.
    await act(async () => {
      await expect(result.current.election.vote([[0]])).rejects.toThrow(/still being relayed/)
    })

    let voteId = ''
    await act(async () => {
      voteId = await first
    })
    expect(voteId).toMatch(/^nullifier-batch-job-/)
    expect(signCalls).toBe(1)

    expect(result.current.election.hasVoted).toBe(true)
  })

  it('reconciles a relay job that outlives the wait instead of vanishing silently', async () => {
    // The batch is accepted but the job never settles within the wait window
    // (slow chain). The provider must not give up with statuses stuck at
    // 'confirming' — it reconciles against the voter state, which by then
    // reports the votes on chain.
    let relayReached = false
    server.use(
      http.post(`http://localhost/votes`, () => {
        relayReached = true
        return HttpResponse.json({ jobId: 'batch-job-slow' }, { status: 202 })
      }),
      // The job stays pending forever, from the client's point of view.
      http.get(`http://localhost/jobs/:jobId`, ({ params }) =>
        HttpResponse.json({
          jobId: params.jobId as string,
          status: 'pending',
          type: 'relay_votes',
        }),
      ),
      http.post(`http://localhost/processes/:processId/check`, () =>
        HttpResponse.json({
          belongsToProcess: true,
          weight: MOCK_WEIGHT_HEX,
          questions: mockProcess.questions.map((q) => ({
            questionId: q.id,
            upstreamId: q.upstreamId,
            canVote: true,
            hasVoted: relayReached,
          })),
        }),
      ),
      http.post(`http://localhost/processes/:processId/sign-info`, () =>
        HttpResponse.json({
          consumed: relayReached
            ? mockProcess.questions.map((q) => ({ questionId: q.id, nullifier: `slowjob-${q.id}` }))
            : [],
        }),
      ),
    )

    const { result } = renderHook(useVoter, { wrapper: reconcilingWrapper })
    await waitFor(() => expect(result.current.election.election).not.toBeNull())
    await connect(result)
    await waitFor(() => expect(result.current.election.isAbleToVote).toBe(true))

    let voteId = ''
    await act(async () => {
      voteId = await result.current.election.vote([[0]])
    })

    expect(voteId).toBe('slowjob-q-0')
    expect(result.current.election.voteStatus).toEqual({ 'q-0': 'confirmed' })
    expect(result.current.election.hasVoted).toBe(true)
  })

  it('clearVoter resets connection and vote state', async () => {
    const { result } = renderHook(useVoter, { wrapper })
    await waitFor(() => expect(result.current.election.election).not.toBeNull())

    await connect(result)
    expect(result.current.election.connected).toBe(true)

    act(() => result.current.election.clearVoter())

    expect(result.current.election.connected).toBe(false)
    expect(result.current.election.weight).toBeNull()
    expect(result.current.election.hasVoted).toBe(false)
    expect(result.current.election.voteId).toBeNull()
    expect(result.current.election.voteIds).toEqual({})
  })
})
