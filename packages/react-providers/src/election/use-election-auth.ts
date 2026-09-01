import type {
  AuthRequest,
  ProcessCheckResponse,
  SignFailureCode,
  VotingProcessResponse,
} from '@vocdoni/api-types'
import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { useClient } from '../client/ClientProvider'

/** Decodes a hex-encoded weight ("2a") into a number; empty/invalid → null. */
function parseWeight(hex?: string): number | null {
  if (!hex) return null
  try {
    return Number(BigInt(`0x${hex.replace(/^0x/, '')}`))
  } catch {
    return null
  }
}

export interface ElectionSignResult {
  /** Hex CSP signature over the voter address. */
  signature: string
  /** Hex-encoded census weight the CSP signed with. */
  weight?: string
}

/** One question's ballot in a {@link ElectionAuthContextValue.signBatch} call. */
export interface ElectionSignBatchBallot {
  /** The question's on-chain election id (its `upstreamId`). */
  electionId: string
  /** Ephemeral address that will cast this question's vote. */
  address: string
}

/**
 * One question's outcome in a batch sign — exactly one of `signature` and
 * `code` is set, so a failure for one question never fails the others.
 */
export interface ElectionSignBatchResult {
  /** The question's on-chain election id (its `upstreamId`). */
  electionId: string
  /** CSP signature (hex) to pass as `cspSignature`, on success. */
  signature?: string
  /** Weight the CSP authorized — pass it back as `cspWeight`, unchanged. */
  weight?: string
  code?: SignFailureCode
  error?: string
}

/**
 * The voter's CSP auth session for the election's voting process. Exposed via
 * {@link useElectionAuth} — a narrower context than `useElection()`, so
 * auth-only widgets (identify forms, OTP inputs, logout buttons) don't
 * re-render when election data or results change.
 */
export interface ElectionAuthContextValue {
  /** Verified auth token — null until the auth flow completes. */
  authToken: string | null
  /** true once the voter holds a verified auth token. */
  connected: boolean
  /** Census weight (decoded), populated after auth/check. */
  weight: number | null
  /**
   * Step 0 — identify the participant. Pass all fields the census requires in the
   * single object, e.g. `{ memberNumber }` or `{ name, surname, birthDate }`. For
   * auth-only censuses this already marks the voter connected; otherwise a 2FA
   * challenge is sent and must be confirmed with {@link auth1}.
   */
  auth0(participant: AuthRequest): Promise<void>
  /** Step 1 — confirm the 2FA challenge (OTP); marks the voter connected. */
  auth1(solution: string | string[]): Promise<void>
  /** Resend the challenge for the pending token. */
  resend(contact: { email?: string; phone?: string }): Promise<void>
  /**
   * The voter's status for the process: census membership, weight and
   * per-question `canVote`/`hasVoted` state.
   */
  check(): Promise<ProcessCheckResponse>
  /**
   * Request the CSP signature over an address for one question's on-chain
   * election (`electionId` is the question's `upstreamId`).
   */
  sign(electionId: string, address: string): Promise<ElectionSignResult>
  /**
   * Request every question's CSP signature in one call — what `vote()` uses.
   * One round trip for the whole process; results come back in request order,
   * with per-question failures reported inline rather than thrown.
   */
  signBatch(ballots: ElectionSignBatchBallot[]): Promise<ElectionSignBatchResult[]>
  /** Clear all auth/voter state. */
  clear(): void
}

export const ElectionAuthContext = createContext<ElectionAuthContextValue | undefined>(undefined)

/**
 * Builds the CSP session for a voting process. Internal to `ElectionProvider`,
 * which provides the resulting value through {@link ElectionAuthContext}; the
 * process read is shared with the caller instead of fetched again.
 */
export function useVoterSession(
  id: string | undefined,
  process: VotingProcessResponse | null,
): ElectionAuthContextValue {
  const { client } = useClient()
  const [pendingToken, setPendingToken] = useState<string | null>(null)
  const [authToken, setAuthToken] = useState<string | null>(null)
  const [weight, setWeight] = useState<number | null>(null)

  // Auth-only censuses (no twoFaFields) issue a verified token at step 0.
  const isAuthOnly = useMemo(
    () => !!process && (process.census?.twoFaFields?.length ?? 0) === 0,
    [process],
  )

  const auth0 = useCallback(
    async (participant: AuthRequest) => {
      // `process` must be loaded too: `isAuthOnly` can't be known without it,
      // and misreading an auth-only census as 2FA would strand the verified
      // step-0 token in `pendingToken` with no auth1 challenge to redeem it.
      if (!id || !process) throw new Error('Election is not loaded yet — cannot authenticate')
      const res = await client.processes.authStep0(id, participant)
      if (!res.authToken) throw new Error('Process auth step 0 did not return a token')
      if (isAuthOnly) {
        // No challenge step: the step-0 token is already verified.
        setAuthToken(res.authToken)
        if (res.weight) setWeight(parseWeight(res.weight))
      } else {
        setPendingToken(res.authToken)
      }
    },
    [client, id, process, isAuthOnly],
  )

  const auth1 = useCallback(
    async (solution: string | string[]) => {
      if (!id) throw new Error('Election is not loaded yet — cannot authenticate')
      if (!pendingToken) throw new Error('Must complete auth step 0 first')
      const authData = Array.isArray(solution) ? solution : [solution]
      const res = await client.processes.authStep1(id, { authToken: pendingToken, authData })
      setAuthToken(res.authToken ?? pendingToken)
      if (res.weight) setWeight(parseWeight(res.weight))
    },
    [client, id, pendingToken],
  )

  const resend = useCallback(
    async (contact: { email?: string; phone?: string }) => {
      if (!id) throw new Error('Election is not loaded yet — cannot authenticate')
      const token = pendingToken ?? authToken
      if (!token) throw new Error('No pending auth token to resend')
      await client.processes.resend(id, { authToken: token, ...contact })
    },
    [client, id, pendingToken, authToken],
  )

  const check = useCallback(async () => {
    if (!id || !authToken) throw new Error('Must authenticate before checking membership')
    const res = await client.processes.check(id, { authToken })
    if (res.weight) setWeight(parseWeight(res.weight))
    return res
  }, [client, id, authToken])

  const sign = useCallback(
    async (electionId: string, address: string): Promise<ElectionSignResult> => {
      if (!id || !authToken) throw new Error('Must authenticate before signing')
      const res = await client.processes.sign(id, { authToken, electionId, payload: address })
      if (!res.signature) throw new Error('Process sign did not return a signature')
      return { signature: res.signature, weight: res.weight }
    },
    [client, id, authToken],
  )

  const signBatch = useCallback(
    async (ballots: ElectionSignBatchBallot[]): Promise<ElectionSignBatchResult[]> => {
      if (!id || !authToken) throw new Error('Must authenticate before signing')
      if (ballots.length === 0) return []
      const res = await client.processes.signBatch(id, {
        authToken,
        ballots: ballots.map((b) => ({ upstreamId: b.electionId, address: b.address })),
      })
      // Indexed rather than zipped: the response is documented as being in
      // request order, but a dropped entry would silently shift every
      // signature onto the wrong question.
      const byElection = new Map(res.signatures.map((s) => [s.upstreamId, s]))
      return ballots.map((b) => {
        const signed = byElection.get(b.electionId)
        return {
          electionId: b.electionId,
          signature: signed?.signature,
          weight: signed?.weight,
          code: signed?.code,
          error: signed?.signature
            ? undefined
            : (signed?.error ?? 'the CSP returned no result for this question'),
        }
      })
    },
    [client, id, authToken],
  )

  const clear = useCallback(() => {
    setPendingToken(null)
    setAuthToken(null)
    setWeight(null)
  }, [])

  return useMemo<ElectionAuthContextValue>(
    () => ({
      authToken,
      connected: !!authToken,
      weight,
      auth0,
      auth1,
      resend,
      check,
      sign,
      signBatch,
      clear,
    }),
    [authToken, weight, auth0, auth1, resend, check, sign, signBatch, clear],
  )
}

/**
 * The voter's CSP auth session. Subscribes only to session state, so an
 * identify form or logout button using this hook won't re-render on election
 * data or results updates the way `useElection()` consumers do.
 */
export function useElectionAuth(): ElectionAuthContextValue {
  const ctx = useContext(ElectionAuthContext)
  if (!ctx) {
    throw new Error(
      'useElectionAuth() must be used inside <ElectionProvider>. ' +
        'Make sure the component is wrapped in <ElectionProvider>.',
    )
  }
  return ctx
}
