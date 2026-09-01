import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { mockProcess } from '../../../../mocks/handlers'
import { server } from '../../../../mocks/server'
import { TestProvider } from '../test-utils'
import { ElectionProvider, useElection } from './ElectionProvider'
import { useElectionAuth } from './use-election-auth'

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <TestProvider>
      <ElectionProvider id={mockProcess.id}>{children}</ElectionProvider>
    </TestProvider>
  )
}

const useHooks = () => ({ auth: useElectionAuth(), election: useElection() })

/** Overrides the process read so the census reads as auth-only (no 2FA fields). */
function useAuthOnlyCensus() {
  server.use(
    http.get('http://localhost/processes/:id', ({ params }) =>
      HttpResponse.json({
        ...mockProcess,
        id: params.id as string,
        census: { authFields: ['memberNumber'], twoFaFields: [] },
      }),
    ),
  )
}

describe('useElectionAuth', () => {
  it('exposes an unconnected session once the election loads', async () => {
    const { result } = renderHook(useHooks, { wrapper })
    await waitFor(() => expect(result.current.election.election).not.toBeNull())
    expect(result.current.election.chainId).toBe('test')
    expect(result.current.auth.connected).toBe(false)
    expect(result.current.auth.authToken).toBeNull()
  })

  describe('2FA census', () => {
    it('stays unverified after step 0 and connects only after step 1', async () => {
      const { result } = renderHook(useHooks, { wrapper })
      await waitFor(() => expect(result.current.election.election).not.toBeNull())

      // Step 0: identify the participant — token issued but NOT yet verified.
      await act(async () => {
        await result.current.auth.auth0({ email: 'voter@example.com' })
      })
      expect(result.current.auth.connected).toBe(false)
      expect(result.current.auth.weight).toBeNull()

      // Step 1: confirm the OTP — now verified, weight resolved.
      await act(async () => {
        await result.current.auth.auth1(['123456'])
      })
      expect(result.current.auth.connected).toBe(true)
      expect(result.current.auth.weight).toBe(42)
      // The merged election context reflects the same session.
      expect(result.current.election.connected).toBe(true)
      expect(result.current.election.weight).toBe(42)
    })

    it('auth1 before auth0 throws', async () => {
      const { result } = renderHook(useHooks, { wrapper })
      await waitFor(() => expect(result.current.election.election).not.toBeNull())
      await expect(result.current.auth.auth1(['123456'])).rejects.toThrow('step 0 first')
    })

    it('resend works on the pending (non-verified) token', async () => {
      const { result } = renderHook(useHooks, { wrapper })
      await waitFor(() => expect(result.current.election.election).not.toBeNull())
      await act(async () => {
        await result.current.auth.auth0({ email: 'voter@example.com' })
      })
      await act(async () => {
        await result.current.auth.resend({ email: 'voter@example.com' })
      })
      expect(result.current.auth.connected).toBe(false)
    })
  })

  describe('auth-only census', () => {
    it('connects directly at step 0 (no OTP), per-question state + weight via check', async () => {
      useAuthOnlyCensus()
      const { result } = renderHook(useHooks, { wrapper })
      await waitFor(() => expect(result.current.election.election).not.toBeNull())

      await act(async () => {
        await result.current.auth.auth0({ memberNumber: '5' })
      })
      // Verified straight away — no auth1 needed.
      expect(result.current.auth.connected).toBe(true)

      let membership
      await act(async () => {
        membership = await result.current.auth.check()
      })
      // The process check reports membership plus per-question state.
      expect(membership).toMatchObject({
        belongsToProcess: true,
        questions: [{ questionId: 'q-0', canVote: true, hasVoted: false }],
      })
      expect(result.current.auth.weight).toBe(42)
    })

    it('clear() resets the session AND the election voter state', async () => {
      useAuthOnlyCensus()
      const { result } = renderHook(useHooks, { wrapper })
      await waitFor(() => expect(result.current.election.election).not.toBeNull())
      await act(async () => {
        await result.current.auth.auth0({ memberNumber: '5' })
      })
      expect(result.current.auth.connected).toBe(true)
      await waitFor(() => expect(result.current.election.isInCensus).toBe(true))

      // Clearing from the auth hook must propagate to the election context —
      // no stale isInCensus/hasVoted left behind.
      act(() => result.current.auth.clear())
      expect(result.current.auth.connected).toBe(false)
      expect(result.current.auth.weight).toBeNull()
      await waitFor(() => expect(result.current.election.isInCensus).toBe(false))
      expect(result.current.election.hasVoted).toBe(false)
      expect(result.current.election.voteId).toBeNull()
    })
  })

  describe('signBatch', () => {
    async function connectAuthOnly() {
      useAuthOnlyCensus()
      const { result } = renderHook(useHooks, { wrapper })
      await waitFor(() => expect(result.current.election.election).not.toBeNull())
      await act(async () => {
        await result.current.auth.auth0({ memberNumber: '5' })
      })
      expect(result.current.auth.connected).toBe(true)
      return result
    }

    it('signs every ballot in ONE sign-batch call, in request order', async () => {
      const batches: Array<Array<{ upstreamId: string; address: string }>> = []
      server.use(
        http.post('http://localhost/processes/:id/sign-batch', async ({ request }) => {
          const body = (await request.json()) as {
            authToken: string
            ballots: Array<{ upstreamId: string; address: string }>
          }
          batches.push(body.ballots)
          return HttpResponse.json({
            signatures: body.ballots.map((b) => ({
              upstreamId: b.upstreamId,
              signature: 'ab'.repeat(65),
              weight: '2a',
            })),
          })
        }),
      )
      const result = await connectAuthOnly()

      let signed: unknown
      await act(async () => {
        signed = await result.current.auth.signBatch([
          { electionId: 'aa'.repeat(32), address: '0x' + '11'.repeat(20) },
          { electionId: 'bb'.repeat(32), address: '0x' + '22'.repeat(20) },
        ])
      })
      // ONE request carrying both ballots, in request order.
      expect(batches).toHaveLength(1)
      expect(batches[0].map((b) => b.upstreamId)).toEqual(['aa'.repeat(32), 'bb'.repeat(32)])
      expect(batches[0].map((b) => b.address)).toEqual(['0x' + '11'.repeat(20), '0x' + '22'.repeat(20)])
      expect(signed).toEqual([
        { electionId: 'aa'.repeat(32), signature: 'ab'.repeat(65), weight: '2a' },
        { electionId: 'bb'.repeat(32), signature: 'ab'.repeat(65), weight: '2a' },
      ])
    })

    it('matches results by upstreamId, so a reordered response cannot shift signatures', async () => {
      server.use(
        http.post('http://localhost/processes/:id/sign-batch', () =>
          HttpResponse.json({
            // Deliberately NOT in request order.
            signatures: [
              { upstreamId: 'bb'.repeat(32), signature: 'b2'.repeat(65), weight: '2a' },
              { upstreamId: 'aa'.repeat(32), signature: 'a1'.repeat(65), weight: '2a' },
            ],
          }),
        ),
      )
      const result = await connectAuthOnly()

      let signed: Array<{ electionId: string; signature?: string }> = []
      await act(async () => {
        signed = await result.current.auth.signBatch([
          { electionId: 'aa'.repeat(32), address: '0x' + '11'.repeat(20) },
          { electionId: 'bb'.repeat(32), address: '0x' + '22'.repeat(20) },
        ])
      })
      expect(signed[0]).toMatchObject({ electionId: 'aa'.repeat(32), signature: 'a1'.repeat(65) })
      expect(signed[1]).toMatchObject({ electionId: 'bb'.repeat(32), signature: 'b2'.repeat(65) })
    })

    it('reports a dropped entry as an inline error instead of shifting the rest', async () => {
      server.use(
        http.post('http://localhost/processes/:id/sign-batch', () =>
          HttpResponse.json({
            // Only the SECOND ballot came back; zipping would hand its
            // signature to the first question.
            signatures: [{ upstreamId: 'bb'.repeat(32), signature: 'b2'.repeat(65), weight: '2a' }],
          }),
        ),
      )
      const result = await connectAuthOnly()

      let signed: Array<{ electionId: string; signature?: string; error?: string }> = []
      await act(async () => {
        signed = await result.current.auth.signBatch([
          { electionId: 'aa'.repeat(32), address: '0x' + '11'.repeat(20) },
          { electionId: 'bb'.repeat(32), address: '0x' + '22'.repeat(20) },
        ])
      })
      expect(signed[0].signature).toBeUndefined()
      expect(signed[0].error).toMatch(/no result/)
      expect(signed[1].signature).toBe('b2'.repeat(65))
    })

    it('passes per-ballot failures through inline', async () => {
      server.use(
        http.post('http://localhost/processes/:id/sign-batch', () =>
          HttpResponse.json({
            signatures: [{ upstreamId: 'aa'.repeat(32), code: 'already_consumed', error: 'slot is spent' }],
          }),
        ),
      )
      const result = await connectAuthOnly()

      let signed: Array<{ electionId: string; code?: string; error?: string }> = []
      await act(async () => {
        signed = await result.current.auth.signBatch([
          { electionId: 'aa'.repeat(32), address: '0x' + '11'.repeat(20) },
        ])
      })
      expect(signed[0].code).toBe('already_consumed')
      expect(signed[0].error).toBe('slot is spent')
    })

    it('returns [] for an empty ballot list without hitting the API', async () => {
      let calls = 0
      server.use(
        http.post('http://localhost/processes/:id/sign-batch', () => {
          calls++
          return HttpResponse.json({ signatures: [] })
        }),
      )
      const result = await connectAuthOnly()

      let signed: unknown
      await act(async () => {
        signed = await result.current.auth.signBatch([])
      })
      expect(signed).toEqual([])
      expect(calls).toBe(0)
    })

    it('throws before authenticating', async () => {
      const { result } = renderHook(useHooks, { wrapper })
      await waitFor(() => expect(result.current.election.election).not.toBeNull())
      await expect(
        result.current.auth.signBatch([{ electionId: 'aa'.repeat(32), address: '0x' + '11'.repeat(20) }]),
      ).rejects.toThrow(/authenticate/)
    })
  })
})
