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

  it('refuses a plain sign() on an anonymous census instead of spending the authorization', async () => {
    let signCalls = 0
    server.use(
      http.get('http://localhost/processes/:id', ({ params }) =>
        HttpResponse.json({
          ...mockProcess,
          id: params.id as string,
          census: { authFields: ['memberNumber'], twoFaFields: [], anonymous: true },
        }),
      ),
      http.post('http://localhost/processes/:id/sign', () => {
        signCalls++
        return HttpResponse.json({ signature: 'ab'.repeat(65) })
      }),
    )
    const { result } = renderHook(useHooks, { wrapper })
    await waitFor(() => expect(result.current.election.election?.census?.anonymous).toBe(true))
    await act(async () => {
      await result.current.auth.auth0({ memberNumber: '5' })
    })

    // The endpoint would answer — with a proof rooted at the wrong key, after
    // the one-shot authorization is already spent.
    await expect(result.current.auth.sign('aa'.repeat(32), '0x' + '11'.repeat(20))).rejects.toThrow(/signBatch/)
    expect(signCalls).toBe(0)
  })
})
