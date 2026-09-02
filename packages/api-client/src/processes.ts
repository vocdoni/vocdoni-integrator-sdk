import type {
  AuthChallengeRequest,
  AuthRequest,
  AuthResendRequest,
  AuthResponse,
  BlindPointRequest,
  BlindPointResponse,
  BlindSignRequest,
  BlindSignResponse,
  CheckMembershipRequest,
  ConsumedAddressRequest,
  ProcessCheckResponse,
  ProcessSignInfoResponse,
  PublicQuestionResponse,
  SignBatchRequest,
  SignBatchResponse,
  SignRequest,
  UserWeightRequest,
  UserWeightResponse,
} from '@vocdoni/api-types'
import type { UpFetch } from 'up-fetch'
import { normalizeQuestionChoiceMeta } from './choice-meta'
import { normalizeQuestionStatus } from './election-status'
import { handleError } from './errors'

/**
 * Voter-side client for the process-scoped CSP routes
 * (`/processes/{processId}/auth|check|sign|weight|sign-info` and the public
 * question read). The auth token is anchored directly to the voting process.
 *
 * Not to be confused with `client.elections` ({@link ElectionsClient}), which
 * wraps the ADMIN side of the same `/processes/{id}` resource (create, publish,
 * census and status management — API-key/JWT authenticated). Everything here is
 * public: the voter is identified by the CSP `authToken`, never by an API key.
 *
 * Ids to keep straight:
 * - `processId` is the process's Mongo ObjectID (the id `elections.get` takes).
 * - `electionId` in {@link sign} is the QUESTION's on-chain Vochain election id
 *   (`question.upstreamId` from the process read), not the process id.
 *
 * Typical voter flow: {@link authStep0} → {@link authStep1} (skip for auth-only
 * censuses) → {@link check} to learn per-question eligibility → {@link signBatch}
 * the ephemeral addresses and cast the votes via `elections.vote`.
 *
 * If the process census is `anonymous`, signing is the two-round blind flow
 * ({@link blindPoint} → {@link blindSign}) instead — the plain sign endpoints
 * reject it.
 */
export class ProcessesCspClient {
  constructor(private readonly fetch: UpFetch) {}

  /**
   * Auth step 0 — identify the participant. Returns a token; for auth-only
   * censuses that token is already verified, otherwise a 2FA challenge is sent
   * and the token must be confirmed via {@link authStep1}.
   */
  async authStep0(processId: string, body: AuthRequest): Promise<AuthResponse> {
    return this.fetch<AuthResponse>(`/processes/${processId}/auth/0`, {
      method: 'POST',
      body,
    }).catch(handleError)
  }

  /** Auth step 1 — confirm the 2FA challenge (OTP) for the step-0 token. */
  async authStep1(processId: string, body: AuthChallengeRequest): Promise<AuthResponse> {
    return this.fetch<AuthResponse>(`/processes/${processId}/auth/1`, {
      method: 'POST',
      body,
    }).catch(handleError)
  }

  /** Resend the challenge for an existing, non-verified auth token. */
  async resend(processId: string, body: AuthResendRequest): Promise<AuthResponse> {
    return this.fetch<AuthResponse>(`/processes/${processId}/auth/resend`, {
      method: 'POST',
      body,
    }).catch(handleError)
  }

  /**
   * The voter's status for the process: census membership, weight and
   * per-question eligibility/vote status. Ineligibility is reported as
   * `belongsToProcess: false` with HTTP 200, not an error.
   */
  async check(processId: string, body: CheckMembershipRequest): Promise<ProcessCheckResponse> {
    return this.fetch<ProcessCheckResponse>(`/processes/${processId}/check`, {
      method: 'POST',
      body,
    }).catch(handleError)
  }

  /**
   * Request the CSP signature over the voter's (ephemeral) address for one
   * question's on-chain election. `body.electionId` is the question's
   * `upstreamId`; each question can only be signed once.
   */
  async sign(processId: string, body: SignRequest): Promise<AuthResponse> {
    return this.fetch<AuthResponse>(`/processes/${processId}/sign`, {
      method: 'POST',
      body,
    }).catch(handleError)
  }

  /**
   * Batch form of {@link sign}: one CSP signature per question of the process,
   * in a single call. Authorization is all-or-nothing — an unauthorized token
   * fails the whole request — while per-question failures come back inline as
   * `{ upstreamId, code, error }` entries in `signatures`, in request order.
   *
   * Prefer this over looping {@link sign} when casting a whole process: it is
   * one round trip, and you learn every failure before putting any vote on
   * chain. Match results by `upstreamId` rather than by position — a dropped
   * entry would otherwise shift every signature onto the wrong question.
   *
   * Not for anonymous censuses — those must use {@link blindPoint} +
   * {@link blindSign}, and this endpoint rejects them.
   */
  async signBatch(processId: string, body: SignBatchRequest): Promise<SignBatchResponse> {
    return this.fetch<SignBatchResponse>(`/processes/${processId}/sign-batch`, {
      method: 'POST',
      body,
    }).catch(handleError)
  }

  /**
   * Round 1 of the anonymous (blind CSP) vote flow: ask the CSP for one blind
   * point R per question. The client blinds its CA bundle against R, then
   * calls {@link blindSign}.
   *
   * Idempotent per election — a repeat returns the same R, so a retry after a
   * network failure is safe. The returned `weight` is pinned here and salts
   * round 2: carry it verbatim into the bundle you blind and into the vote
   * transaction. `@vocdoni/api-voting`'s `signBlindCspBallots` drives both
   * rounds and the blinding for you.
   */
  async blindPoint(processId: string, body: BlindPointRequest): Promise<BlindPointResponse> {
    return this.fetch<BlindPointResponse>(`/processes/${processId}/blind-point`, {
      method: 'POST',
      body,
    }).catch(handleError)
  }

  /**
   * Round 2 of the anonymous vote flow: the CSP signs the blinded messages
   * without being able to read them. Each result carries the raw
   * blind-signature scalar, which the client unblinds into the final `ProofCA`
   * signature.
   */
  async blindSign(processId: string, body: BlindSignRequest): Promise<BlindSignResponse> {
    return this.fetch<BlindSignResponse>(`/processes/${processId}/blind-sign`, {
      method: 'POST',
      body,
    }).catch(handleError)
  }

  /** Get the voter's census weight for the process. */
  async weight(processId: string, body: UserWeightRequest): Promise<UserWeightResponse> {
    return this.fetch<UserWeightResponse>(`/processes/${processId}/weight`, {
      method: 'POST',
      body,
    }).catch(handleError)
  }

  /**
   * Consumed sign info: per-question address, nullifier and timestamp for the
   * questions the voter has already cast (others are omitted).
   */
  async signInfo(processId: string, body: ConsumedAddressRequest): Promise<ProcessSignInfoResponse> {
    return this.fetch<ProcessSignInfoResponse>(`/processes/${processId}/sign-info`, {
      method: 'POST',
      body,
    }).catch(handleError)
  }

  /**
   * Public voter read of a single question — choices, `ballotProtocol`, census
   * auth config and `encryptionKeys`, no API key needed. For
   * `secretUntilTheEnd` questions, `encryptionKeys` is absent until the
   * keykeepers publish the keys — poll until present before building an
   * encrypted ballot.
   *
   * Normalized like every other question read: the wire `READY` status becomes
   * `ONGOING`, and `metadata.choices` is folded onto each choice as
   * `choice.meta`, so a voter-side UI gets the same extended choice info
   * (image, description) as `elections.get`.
   */
  async getQuestion(processId: string, questionId: string): Promise<PublicQuestionResponse> {
    return this.fetch<PublicQuestionResponse>(`/processes/${processId}/questions/${questionId}`)
      .then((q) => normalizeQuestionChoiceMeta({ ...q, status: normalizeQuestionStatus(q.status) }))
      .catch(handleError)
  }

}
