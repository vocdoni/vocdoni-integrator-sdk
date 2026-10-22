import type {
  ProcessCheckResponse,
  ProcessQuestionStatus,
  QuestionStatus,
  VoteJobResult,
  VotingProcessResponse,
  VotingProcessResultsResponse,
} from '@vocdoni/api-types'
import {
  buildVoteTransaction,
  EphemeralSigner,
  MAX_MEMO_BYTES,
  ProofCA_Type,
  strip0x,
  voteNullifier,
} from '@vocdoni/api-voting'
import { useQuery, type UseQueryOptions } from '@tanstack/react-query'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { JobFailedError, normalizeVotingProcess, VocdoniApiError, type VocdoniApiClient } from '@vocdoni/api-client'
import { useClient } from '../client/ClientProvider'
import {
  clearPendingVotes,
  listPendingVotes,
  removePendingVote,
  savePendingVote,
  type PendingVote,
} from './pending-votes'
import {
  ElectionAuthContext,
  useVoterSession,
  type ElectionAuthContextValue,
} from './use-election-auth'
import { useProcessStatus } from './use-process-status'

/**
 * Query keys the election provider reads through. Exported so consumers can
 * pre-seed (`setQueryData`) or invalidate these queries without hardcoding the
 * key shape.
 */
export const electionQueryKeys = {
  election: (id: string) => ['process', id] as const,
  results: (id: string) => ['process-results', id] as const,
}

/**
 * One question's progress through a `vote()` call: CSP-signing the envelope,
 * built and waiting for the batch relay, accepted and awaiting chain
 * confirmation, then confirmed (on chain) or failed. Two states come from the
 * voter's status rather than from a call, and are also set on connect:
 * - `unconfirmed`: the CSP signed the vote but it is not on chain, and this
 *   tab holds no signed tx to re-send (non-anonymous census);
 * - `signed`: the CSP authorized the vote of an anonymous census, and this tab
 *   cannot confirm it on chain (no stored nullifier).
 * Neither can be voted again.
 */
export type QuestionVoteStatus =
  | 'signing'
  | 'submitting'
  | 'confirming'
  | 'confirmed'
  | 'failed'
  | 'unconfirmed'
  | 'signed'

/** Hard cap of `POST /votes` — the backend rejects larger batches. */
const MAX_VOTE_BATCH = 100

/**
 * Election data, results and the vote flow, plus the voter's CSP auth session
 * (inherited from {@link ElectionAuthContextValue} — `auth0`/`auth1`/`resend`
 * to authenticate, `check`/`signBatch` for advanced UIs; the session's `clear` is
 * exposed here as {@link clearVoter}).
 */
export interface ElectionContextValue extends Omit<ElectionAuthContextValue, 'clear'> {
  election: VotingProcessResponse | null
  /**
   * Derived process status from all question statuses. A process whose
   * `startDate` is still ahead reads as `UPCOMING` and flips to `ONGOING` by
   * itself at the start, without a refetch.
   */
  status: QuestionStatus | null
  /** Vochain chain id the process's votes are signed against. */
  chainId: string | null
  /** Per-question results from `GET /processes/{id}/results`. */
  results: VotingProcessResultsResponse | null
  loading: boolean
  error: Error | null

  /** Whether the voter belongs to this process's census. */
  isInCensus: boolean
  /**
   * Per-question voter state (`canVote`/`hasVoted`/`hasSigned`) from the CSP
   * check. `hasVoted` means on chain: an anonymous-census question confirmed
   * through `POST /votes/verify` reads `hasVoted: true` here even though the
   * backend reports `false`. Empty until the voter is connected and the
   * membership check resolves.
   */
  voterQuestions: ProcessQuestionStatus[]
  /** true when every question of the process is on chain. */
  hasVoted: boolean
  /**
   * Questions whose signed tx is stored in this tab but not on chain yet,
   * keyed by question id. They are re-sent (the same tx, no new CSP signature)
   * on connect and by the next `vote()`, and their ballot is fixed: render
   * them read-only.
   */
  pendingVotes: Record<string, true>

  /**
   * Cast votes for all questions in the process. Accepts per-question encoded
   * ballots (`number[][]`, one entry per question) and optional per-question
   * memos (free-text notes, e.g. an open "Other" answer — max 256 UTF-8 bytes
   * each, and ⚠️ always cleartext on the envelope, even for secret questions).
   * Returns the first vote id cast by this call — one vote id is relayed per
   * question, so read {@link voteIds} for all of them.
   *
   * Casting is phased so a failure can't half-vote silently: a fresh check
   * decides each question's state (throws `Could not verify your voting
   * status; try again` when it cannot), every open question is validated and
   * CSP-signed and every transaction built and stored BEFORE anything is
   * relayed, then the whole batch is relayed in ONE call (`POST /votes`) that
   * the backend accepts or rejects as a unit. Questions already on chain are
   * skipped. Questions in {@link pendingVotes} re-send their stored tx — their
   * entry in `encodedBallots` is ignored. A question is confirmed only on
   * on-chain evidence (the relay job, the check's `hasVoted`, or
   * `POST /votes/verify` for an anonymous census). If some votes land and
   * others fail, throws {@link PartialVoteError} naming both sets; if nothing
   * is left to sign or re-send, throws {@link UnconfirmedVoteError}.
   */
  vote(encodedBallots: number[][], memos?: (string | undefined)[]): Promise<string>
  /**
   * true exactly while a `vote()` call is in flight — from entry until it
   * settles, whether it resolves or throws. Drive "processing your vote"
   * overlays and disable submit buttons with it (double-submit guard).
   */
  voting: boolean
  /**
   * Per-question progress of the current (or last) `vote()` call, keyed by
   * question id: `signing` → `submitting` → `confirming` → `confirmed` or
   * `failed`. Questions the call skipped because they were already voted
   * appear as `confirmed`; `unconfirmed`/`signed` questions appear as such
   * from connect on. A `failed` question whose error is `could not confirm
   * the vote on chain yet` is unknown, not rejected. Cleared by
   * {@link clearVoter} and on disconnect.
   */
  voteStatus: Record<string, QuestionVoteStatus>
  /**
   * Every vote id (nullifier) the voter holds for this process, keyed by
   * question id — one entry per question already cast. Populated from the
   * outcomes of `vote()` (including the questions that landed when it throws
   * {@link PartialVoteError}) and, on load, recovered from
   * `POST /processes/{id}/sign-info`, so a voter returning after a reload still
   * sees all of them. Empty until the voter is connected and has voted.
   */
  voteIds: Record<string, string>
  /**
   * The first vote id cast by the last `vote()` call — or, before any call in
   * this session, the first one recovered from sign-info.
   *
   * @deprecated Votes are relayed per question, so a process with more than one
   * question yields more than one vote id. Read {@link voteIds} instead; this
   * field only ever exposes one of them.
   */
  voteId: string | null
  /**
   * Connected, in the census, not fully voted, and some question the voter is
   * eligible for is either not signed yet or pending a re-send.
   */
  isAbleToVote: boolean
  /** Clears the voter's auth session and vote state (the tab's stored txs are kept). */
  clearVoter(): void
}

/**
 * Extra react-query options for the election read. `queryKey`, `queryFn`,
 * `enabled` and `initialData` are provider-owned.
 */
export type ElectionQueryOptions = Omit<
  UseQueryOptions<VotingProcessResponse, Error>,
  'queryKey' | 'queryFn' | 'enabled' | 'initialData'
>

/** Extra react-query options for the results read — same rules as {@link ElectionQueryOptions}. */
export type ElectionResultsQueryOptions = Omit<
  UseQueryOptions<VotingProcessResultsResponse | null, Error>,
  'queryKey' | 'queryFn' | 'enabled' | 'initialData'
>

/**
 * Tuning for the vote relay's unknown-outcome reconciliation. When the relay
 * response is lost (network error, proxy-authored 502/504) or the job wait
 * gives up, the backend may still land the votes, so the provider polls the
 * on-chain evidence (`check()`, plus `POST /votes/verify` for an anonymous
 * census) before declaring failure. The default window (48 × 2.5 s) covers the
 * backend's worst case. Mainly for tests.
 */
export interface VoteReconcileOptions {
  /** How many polls before giving up. Default 48. */
  attempts?: number
  /** Delay between polls, in milliseconds. Default 2500. */
  intervalMs?: number
}

export interface VoteOptions {
  reconcile?: VoteReconcileOptions
  /**
   * How long to wait for the relay job before falling back to voter-state
   * reconciliation, in milliseconds. Defaults to the api-client's job wait
   * default (60s).
   */
  jobTimeoutMs?: number
}

export interface ElectionProviderBaseProps {
  children: ReactNode
  /** Election ID (the voting process Mongo ObjectID) — fetches the election on mount. */
  id?: string
  /**
   * Prefetched election, rendered immediately instead of a loading state.
   * Seeded into the query cache as `initialData`, so the provider still
   * refetches — by `id`, or by `election.id` when `id` is omitted — whenever
   * the query goes stale (immediately, under the default `staleTime` of 0).
   */
  election?: VotingProcessResponse
  /**
   * Extra react-query options for the election read, e.g. `refetchInterval`
   * to poll for status changes or `staleTime` to trust prefetched data.
   */
  queryOptions?: ElectionQueryOptions
  /**
   * Extra react-query options for the results read, e.g. `refetchInterval`
   * for live tallies.
   */
  resultsQueryOptions?: ElectionResultsQueryOptions
  /** Vote relay tuning — see {@link VoteOptions}. */
  voteOptions?: VoteOptions
}

/** At least one of `id` or `election` must be provided. */
export type ElectionProviderProps = ElectionProviderBaseProps &
  ({ id: string } | { election: VotingProcessResponse })

/**
 * Thrown by `vote()` when some questions' votes landed on chain and others
 * failed. The voter is partially voted: calling `vote()` again with the same
 * ballots resumes — already-voted questions are skipped — so the UI should
 * offer a retry, not treat the whole cast as lost.
 */
export class PartialVoteError extends Error {
  constructor(
    /** Questions whose vote landed, with the vote id (nullifier) of each. */
    readonly succeeded: Array<{ questionId: string; voteId: string }>,
    /** Questions whose vote failed, with the error that failed each one. */
    readonly failed: Array<{ questionId: string; error: unknown }>,
  ) {
    super(
      `Vote partially failed: ${succeeded.length} question(s) cast, ${failed.length} failed ` +
        `(${failed.map((f) => f.questionId).join(', ')}); call vote() again to retry the failed ones`,
    )
    this.name = 'PartialVoteError'
  }
}

/**
 * Thrown by `vote()` when no question is left to sign or re-send: the rest are
 * signed by the CSP but cannot be confirmed from this tab — `unconfirmed` (not
 * on chain, no stored tx) or `signed` (anonymous census, no stored nullifier).
 * Retrying does not help; the voter should contact the organizer.
 */
export class UnconfirmedVoteError extends Error {
  constructor(readonly questions: Array<{ questionId: string; status: 'unconfirmed' | 'signed' }>) {
    super(
      `No question left to vote: ${questions.map((q) => `${q.questionId} (${q.status})`).join(', ')} ` +
        'were signed but cannot be confirmed on chain from this tab',
    )
    this.name = 'UnconfirmedVoteError'
  }
}

const COULD_NOT_VERIFY = 'Could not verify your voting status; try again'
/** Error message of a question whose outcome is unknown (the verification failed). */
const COULD_NOT_CONFIRM = 'could not confirm the vote on chain yet'

/** Folds a `succeeded` list into the `questionId → voteId` map shape. */
// Entries with no id are dropped: a vote can land without a recoverable vote id
// (an anonymous census has no nullifier to recover), and mapping the question to
// an empty string would read as "voted, id known to be blank".
const byQuestion = (succeeded: Array<{ questionId: string; voteId: string }>): Record<string, string> =>
  Object.fromEntries(succeeded.filter((s) => !!s.voteId).map((s) => [s.questionId, s.voteId]))

const ElectionContext = createContext<ElectionContextValue | undefined>(undefined)

const sameHex = (a?: string, b?: string) => !!a && !!b && strip0x(a).toLowerCase() === strip0x(b).toLowerCase()

type Question = VotingProcessResponse['questions'][number]

/** A question's state from a fresh check (see {@link resolveVoterState}). */
type QuestionState = 'confirmed' | 'pending' | 'unconfirmed' | 'signed' | 'open'

interface VoterState {
  checked: ProcessCheckResponse
  states: Record<string, QuestionState>
  /** The current voter's own stored entry, per question id. */
  own: Record<string, PendingVote>
  /** Nullifiers sign-info reported, per question id (non-anonymous census). */
  consumed: Record<string, string>
  /** sign-info or `/votes/verify` failed where it was needed: the states are a best guess. */
  unverified: boolean
}

/** One envelope of a relay: a fresh tx, or a stored one re-sent. */
interface RelayItem {
  question: Question
  /** Question index, to keep the batch in question order. */
  i: number
  txPayload: string
  nullifier: string
}

/**
 * Each question's state, shared by connect and `vote()`:
 * - on chain (`hasVoted`, or an own entry `/votes/verify` confirms) → confirmed;
 * - an own entry with its tx → pending (re-send it);
 * - signed, nothing of ours stored → `unconfirmed` (plain census: the backend
 *   checked the chain) or `signed` (anonymous: it cannot);
 * - not signed → open.
 * An entry is the voter's own only when its owner is this session's, the CSP
 * signed the question, and (plain census) its nullifier is the one sign-info
 * reports. Others' entries are never relayed, verified or deleted. A backend
 * without `hasSigned` reads as today: `hasVoted` → confirmed, else open.
 */
async function resolveVoterState(
  client: VocdoniApiClient,
  election: VotingProcessResponse,
  checked: ProcessCheckResponse,
  owner: string | null,
  authToken: string,
): Promise<VoterState> {
  const anonymous = !!election.census?.anonymous
  const byId = new Map(checked.questions.map((q) => [q.questionId, q]))
  let unverified = false

  // An anonymous census reports no nullifier by design (the CSP blind signs
  // and never learns the address), so sign-info is only worth a request for a
  // plain one: to recover vote ids, and to tell our entries from another tab's.
  let consumed: Record<string, string> = {}
  if (!anonymous && checked.questions.some((q) => q.hasVoted || q.hasSigned)) {
    const info = await client.elections.signInfo(election.id, { authToken }).catch(() => null)
    if (info) {
      consumed = Object.fromEntries(
        info.consumed.filter((c) => !!c.nullifier).map((c) => [c.questionId, c.nullifier!]),
      )
    } else if (checked.questions.some((q) => q.hasSigned && !q.hasVoted)) {
      unverified = true
    }
  }

  const own: Record<string, PendingVote> = {}
  if (owner) {
    for (const question of election.questions) {
      if (!question.upstreamId || byId.get(question.id)?.hasSigned !== true) continue
      const mine = listPendingVotes(question.upstreamId)
        .filter((e) => e.owner === owner && (anonymous || sameHex(e.nullifier, consumed[question.id])))
        .sort((a, b) => b.savedAt - a.savedAt)[0]
      if (mine) own[question.id] = mine
    }
  }

  const verified = new Set<string>()
  const toVerify = anonymous ? Object.entries(own).filter(([id]) => !byId.get(id)?.hasVoted) : []
  if (toVerify.length > 0) {
    try {
      const { votes } = await client.elections.verifyVotes(toVerify.map(([, e]) => e.nullifier))
      for (const [id, e] of toVerify) {
        if (votes.some((v) => v.verified && sameHex(v.nullifier, e.nullifier))) verified.add(id)
      }
    } catch {
      unverified = true
    }
  }

  const states: Record<string, QuestionState> = {}
  for (const question of election.questions) {
    const q = byId.get(question.id)
    const entry = own[question.id]
    if (q?.hasVoted || verified.has(question.id)) {
      states[question.id] = 'confirmed'
      if (entry && (!anonymous || entry.txPayload)) settleEntry(question, entry, anonymous)
    } else if (entry?.txPayload) {
      states[question.id] = 'pending'
    } else if (q?.hasSigned) {
      states[question.id] = anonymous ? 'signed' : 'unconfirmed'
    } else {
      states[question.id] = 'open'
    }
  }
  return { checked, states, own, consumed, unverified }
}

/**
 * A confirmed vote's entry: a plain census drops it (`/check` is the truth from
 * now on); an anonymous one keeps the nullifier, without the tx, so a reload of
 * this tab can verify it again.
 */
function settleEntry(question: Question, entry: Pick<PendingVote, 'owner' | 'nullifier'>, anonymous: boolean) {
  if (!question.upstreamId) return
  if (!anonymous) return removePendingVote(question.upstreamId, entry.nullifier)
  const now = Date.now()
  savePendingVote(question.upstreamId, { owner: entry.owner, nullifier: entry.nullifier, savedAt: now, confirmedAt: now })
}

/** The voter state's per-question status for `voteStatus`, before anything is relayed. */
const initialStatus: Record<QuestionState, QuestionVoteStatus> = {
  confirmed: 'confirmed',
  pending: 'submitting',
  unconfirmed: 'unconfirmed',
  signed: 'signed',
  open: 'signing',
}

/**
 * Fetches the election and provides its data, results and the vote flow via
 * `useElection()`, plus the voter's CSP auth session — hosted in a separate
 * context readable through `useElectionAuth()`, so auth-only widgets don't
 * re-render on data/results updates.
 */
export function ElectionProvider({
  children,
  id,
  election: prefetched,
  queryOptions,
  resultsQueryOptions,
  voteOptions,
}: ElectionProviderProps) {
  const { client } = useClient()

  // The id drives every query; a prefetched election carries its own, so
  // passing only `election` still leaves the provider able to refetch.
  const electionId = id ?? prefetched?.id

  // A prefetched process is raw wire data (SSR payload, cache dump) that never
  // went through the client's read boundary, so run it through the same
  // normalization the fetch path applies — otherwise the first paint would show
  // `READY` statuses and choices without their extended info, and only settle
  // once the refetch lands. Idempotent, so an already-normalized process is
  // unaffected.
  const initialElection = useMemo(
    () => (prefetched && prefetched.id === electionId ? normalizeVotingProcess(prefetched) : undefined),
    [prefetched, electionId],
  )

  const {
    data: election = null,
    isLoading: loading,
    error,
  } = useQuery<VotingProcessResponse, Error>({
    ...queryOptions,
    queryKey: electionQueryKeys.election(electionId!),
    queryFn: () => client.elections.get(electionId!),
    enabled: !!electionId,
    // Never seed the cache entry of `id` with a *different* election's data
    // (guarded when building `initialElection`).
    initialData: initialElection,
  })

  const { data: results = null } = useQuery<VotingProcessResultsResponse | null, Error>({
    ...resultsQueryOptions,
    queryKey: electionQueryKeys.results(electionId!),
    // A 404 legitimately means "no results yet" (e.g. before any question is
    // published) — swallow it instead of letting react-query retry the endpoint.
    queryFn: () =>
      client.elections.getResults(electionId!).catch((err) => {
        if (err instanceof VocdoniApiError && err.status === 404) return null
        throw err
      }),
    enabled: !!electionId && !!election,
  })

  const session = useVoterSession(electionId, election)

  const chainId = election?.chainId ?? null

  const status = useProcessStatus(election)

  const [voteId, setVoteId] = useState<string | null>(null)
  const [voteIds, setVoteIds] = useState<Record<string, string>>({})
  const [voting, setVoting] = useState(false)
  const [voteStatus, setVoteStatus] = useState<Record<string, QuestionVoteStatus>>({})
  const [hasVoted, setHasVoted] = useState(false)
  const [isInCensus, setIsInCensus] = useState(false)
  const [voterQuestions, setVoterQuestions] = useState<ProcessQuestionStatus[]>([])
  const [pendingVotes, setPendingVotes] = useState<Record<string, true>>({})

  // Hard-guards overlapping relays — a vote() call, or the re-send on connect.
  // A second vote() while the first is still relaying would re-sign the same
  // questions with a FRESH ephemeral signer and race the in-flight batch; a
  // StrictMode double effect would relay the stored txs twice.
  const castInFlightRef = useRef(false)

  /** Publishes a fresh voter state: membership, per-question state, recovered vote ids. */
  const applyVoterState = useCallback((vs: VoterState) => {
    const { checked, states, own, consumed } = vs
    setIsInCensus(checked.belongsToProcess)
    setVoterQuestions(
      checked.questions.map((q) => (states[q.questionId] === 'confirmed' && !q.hasVoted ? { ...q, hasVoted: true } : q)),
    )
    setHasVoted(checked.questions.length > 0 && checked.questions.every((q) => states[q.questionId] === 'confirmed'))
    setPendingVotes(
      Object.fromEntries(
        Object.entries(states)
          .filter(([, st]) => st === 'pending')
          .map(([id]) => [id, true as const]),
      ),
    )
    setVoteStatus((prev) => {
      const next = { ...prev }
      for (const [id, st] of Object.entries(states)) {
        if (st === 'unconfirmed' || st === 'signed') next[id] = st
        else if (next[id] === 'unconfirmed' || next[id] === 'signed') delete next[id]
      }
      return next
    })
    // Vote ids of what is on chain only: sign-info also lists signed questions.
    const recovered: Record<string, string> = {}
    for (const [id, st] of Object.entries(states)) {
      if (st !== 'confirmed') continue
      const voteId = consumed[id] ?? (own[id] ? strip0x(own[id].nullifier) : undefined)
      if (voteId) recovered[id] = voteId
    }
    // Ids cast in this session win: they came straight from the relay job.
    setVoteIds((prev) => ({ ...recovered, ...prev }))
    const first = Object.values(recovered)[0]
    if (first) setVoteId((prev) => prev ?? first)
  }, [])

  /**
   * Relays `items` in ONE batch and settles each question on on-chain evidence
   * only: the job said `completed`, or — failed, missing or unknown outcome —
   * `check().hasVoted` / `POST /votes/verify` (anonymous census) says so. A
   * confirmed question's entry is settled; anything else keeps its stored tx
   * for the next `vote()` or connect. Throws a plain error when the batch was
   * rejected as a unit, or when nothing landed after an unknown outcome.
   */
  const relay = useCallback(
    async (
      items: RelayItem[],
      // true once the caller's result no longer applies (the connect effect was
      // cancelled): the relay still settles, but writes no more vote state.
      isStale: () => boolean = () => false,
    ): Promise<{
      succeeded: Array<{ questionId: string; voteId: string }>
      failed: Array<{ questionId: string; error: unknown }>
    }> => {
      const anonymous = !!election?.census?.anonymous
      const owner = session.owner
      const setStatus = (ids: string[], st: QuestionVoteStatus) => {
        if (isStale()) return
        setVoteStatus((prev) => {
          const next = { ...prev }
          for (const id of ids) next[id] = st
          return next
        })
      }
      const allIds = items.map((it) => it.question.id)
      // Every item's tx is stored (when there is an owner to store it under):
      // a batch that was refused or never answered leaves them all pending.
      const keepPending = () => {
        if (!owner || isStale()) return
        setPendingVotes((prev) => ({ ...prev, ...Object.fromEntries(allIds.map((id) => [id, true as const])) }))
      }

      // One job covers the batch; its per-envelope entries settle one by one
      // while the job is pending — mirror every poll into voteStatus. A failed
      // entry stays `confirming`: it is verified on chain before it is final.
      const applyOutcomes = (votes: VoteJobResult[] | undefined) => {
        if (!votes || isStale()) return
        setVoteStatus((st) => {
          const next = { ...st }
          votes.forEach((v, idx) => {
            const question = items[idx]?.question
            if (question) next[question.id] = v.status === 'completed' ? 'confirmed' : 'confirming'
          })
          return next
        })
      }

      // On-chain evidence for `subset`: the check's hasVoted, plus the stored
      // nullifier through /votes/verify for an anonymous census on a backend
      // that reports hasSigned (hasVoted is always false there). Throws when
      // either cannot be read — unknown, never "not voted".
      const onChain = async (subset: RelayItem[]): Promise<Set<string>> => {
        const checked = await session.check()
        const byId = new Map(checked.questions.map((q) => [q.questionId, q]))
        const landed = new Set(subset.filter((it) => byId.get(it.question.id)?.hasVoted).map((it) => it.question.id))
        const toVerify = anonymous
          ? subset.filter((it) => !landed.has(it.question.id) && typeof byId.get(it.question.id)?.hasSigned === 'boolean')
          : []
        if (toVerify.length > 0) {
          const { votes } = await client.elections.verifyVotes(toVerify.map((it) => it.nullifier))
          for (const it of toVerify) {
            if (votes.some((v) => v.verified && sameHex(v.nullifier, it.nullifier))) landed.add(it.question.id)
          }
        }
        return landed
      }

      // An unknown outcome: the backend may still land the votes (it retries a
      // submit for 30 s and waits up to 2 × 40 s for the block), so poll the
      // on-chain evidence for a bounded window; votes land one by one.
      const reconcile = async (): Promise<{ landed: Set<string>; verifyFailed: boolean }> => {
        const attempts = voteOptions?.reconcile?.attempts ?? 48
        const intervalMs = voteOptions?.reconcile?.intervalMs ?? 2500
        const landed = new Set<string>()
        let verifyFailed = false
        for (let attempt = 0; attempt < attempts; attempt++) {
          if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, intervalMs))
          try {
            for (const id of await onChain(items)) landed.add(id)
            verifyFailed = false
          } catch {
            verifyFailed = true
            continue
          }
          if (items.every((it) => landed.has(it.question.id))) break
        }
        return { landed, verifyFailed }
      }

      // A response the origin server authored — a 4xx validation error or a
      // backend 5xx like the queue-full 503 — means the batch was definitively
      // rejected AS A UNIT and zero votes are on chain. A missing response
      // (network error) or a proxy-authored 502/504 leaves the outcome unknown.
      const isUnknownRelayOutcome = (err: unknown) =>
        !(err instanceof VocdoniApiError) || err.status === 502 || err.status === 504

      let jobId: string | null = null
      let unknown: { error: unknown } | null = null
      try {
        ;({ jobId } = await client.elections.voteBatch({ votes: items.map(({ txPayload }) => ({ txPayload })) }))
      } catch (err) {
        if (!isUnknownRelayOutcome(err)) {
          setStatus(allIds, 'failed')
          keepPending()
          throw err
        }
        unknown = { error: err }
      }
      setStatus(allIds, 'confirming')

      // The job completes only when EVERY envelope landed and fails otherwise;
      // a failed job still carries the per-vote outcomes. A wait that gives up
      // (timeout, poll failure) is an unknown outcome, not a failure.
      let outcomes: VoteJobResult[] = []
      if (!unknown) {
        try {
          const job = await client.jobs.waitFor(jobId!, {
            expectType: 'relay_votes',
            timeoutMs: voteOptions?.jobTimeoutMs,
            onPoll: (j) => applyOutcomes(j.result?.votes),
          })
          outcomes = job.result?.votes ?? []
        } catch (err) {
          if (err instanceof JobFailedError) outcomes = err.job.result?.votes ?? []
          else unknown = { error: err }
        }
        applyOutcomes(outcomes)
      }

      const succeeded: Array<{ questionId: string; voteId: string }> = []
      const failed: Array<{ questionId: string; error: unknown }> = []
      const confirm = (it: RelayItem, voteId: string) => {
        succeeded.push({ questionId: it.question.id, voteId })
        if (owner) settleEntry(it.question, { owner, nullifier: it.nullifier }, anonymous)
      }
      const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err))

      if (unknown) {
        const { landed, verifyFailed } = await reconcile()
        if (landed.size === 0) {
          setStatus(allIds, 'failed')
          keepPending()
          throw verifyFailed ? new Error(COULD_NOT_CONFIRM) : unknown.error
        }
        for (const it of items) {
          if (landed.has(it.question.id)) confirm(it, strip0x(it.nullifier))
          else
            failed.push({
              questionId: it.question.id,
              error: new Error(verifyFailed ? COULD_NOT_CONFIRM : messageOf(unknown.error)),
            })
        }
      } else {
        // A job-reported failure is not the last word either way: the envelope
        // may be on chain ("nullifier already exists" after a duplicate relay),
        // and the dev incident shows a "signed" check must never stand in for
        // it. Verify on chain; a verification error is unknown, not rejected.
        const notDone: Array<{ it: RelayItem; error?: string }> = []
        items.forEach((it, idx) => {
          const outcome = outcomes[idx]
          if (outcome?.status === 'completed') confirm(it, outcome.voteID ?? outcome.nullifier)
          else notDone.push({ it, error: outcome?.error })
        })
        if (notDone.length > 0) {
          let landed = new Set<string>()
          let verifyFailed = false
          try {
            landed = await onChain(notDone.map(({ it }) => it))
          } catch {
            verifyFailed = true
          }
          for (const { it, error } of notDone) {
            if (landed.has(it.question.id)) confirm(it, strip0x(it.nullifier))
            else
              failed.push({
                questionId: it.question.id,
                error: new Error(
                  verifyFailed ? COULD_NOT_CONFIRM : (error ?? `Vote for question ${it.question.id} did not complete`),
                ),
              })
          }
        }
      }

      setStatus(
        succeeded.map((s) => s.questionId),
        'confirmed',
      )
      setStatus(
        failed.map((f) => f.questionId),
        'failed',
      )
      // A failed question keeps its stored tx (when there is an owner to store it under).
      if (!isStale()) {
        setPendingVotes((prev) => {
          const next = { ...prev }
          for (const s of succeeded) delete next[s.questionId]
          if (owner) for (const f of failed) next[f.questionId] = true
          return next
        })
      }
      return { succeeded, failed }
    },
    [election, session, client, voteOptions],
  )

  /**
   * Publishes what a relay confirmed. `hasVoted` turns true only when every
   * question is on chain. Returns whether it did.
   */
  const applyRelayResult = useCallback(
    (vs: VoterState, succeeded: Array<{ questionId: string; voteId: string }>): boolean => {
      const landed = new Set(succeeded.map((s) => s.questionId))
      if (succeeded.length > 0) setVoteIds((prev) => ({ ...prev, ...byQuestion(succeeded) }))
      setVoterQuestions((qs) => qs.map((q) => (landed.has(q.questionId) ? { ...q, hasVoted: true } : q)))
      const all =
        vs.checked.questions.length > 0 &&
        vs.checked.questions.every((q) => vs.states[q.questionId] === 'confirmed' || landed.has(q.questionId))
      if (all) setHasVoted(true)
      return all
    },
    [],
  )

  /** The stored txs of the pending questions, in question order. */
  const pendingItems = (vs: VoterState): RelayItem[] =>
    (election?.questions ?? []).flatMap((question, i) =>
      vs.states[question.id] === 'pending'
        ? [{ question, i, txPayload: vs.own[question.id].txPayload!, nullifier: vs.own[question.id].nullifier }]
        : [],
    )

  // A process that is over can never take its stored txs: drop them, whoever owns them.
  useEffect(() => {
    if (!election || !(status === 'ENDED' || status === 'RESULTS' || status === 'CANCELED')) return
    for (const question of election.questions) {
      if (question.upstreamId) clearPendingVotes(question.upstreamId)
    }
  }, [election, status])

  // Resolve the voter's state once the session is connected: membership,
  // per-question state, the vote ids of what is on chain. Then re-send the
  // pending questions once, through the same relay as vote(), with no
  // signing. The disconnect branch also resets the vote state, so clearing the
  // session from useElectionAuth() propagates here.
  useEffect(() => {
    if (!session.connected || !election) {
      setIsInCensus(false)
      setVoterQuestions([])
      setHasVoted(false)
      setVoteId(null)
      setVoteIds({})
      setVoteStatus({})
      setPendingVotes({})
      return
    }

    let cancelled = false
    session
      .check()
      .then(async (checked) => {
        if (cancelled) return
        const vs = await resolveVoterState(client, election, checked, session.owner, session.authToken!)
        if (cancelled) return
        applyVoterState(vs)

        const items = pendingItems(vs)
        // Skipped when a vote() (or the other StrictMode run) already relays.
        if (items.length === 0 || status !== 'ONGOING' || castInFlightRef.current) return
        castInFlightRef.current = true
        setVoting(true)
        setVoteStatus((prev) => ({ ...prev, ...Object.fromEntries(items.map((it) => [it.question.id, 'submitting'])) }))
        try {
          const { succeeded } = await relay(items, () => cancelled)
          if (!cancelled) applyRelayResult(vs, succeeded)
        } catch {
          // statuses are already `failed`; the entries stay for the next try
        } finally {
          castInFlightRef.current = false
          setVoting(false)
        }
      })
      .catch(() => {
        // ineligible / network error — leave membership as not-in-census
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.authToken, session.owner, election?.id, status])

  const castVotes = useCallback(
    async (encodedBallots: number[][], memos?: (string | undefined)[]): Promise<string> => {
      if (!election) throw new Error('Election not loaded')
      if (!session.connected) throw new Error('Voter is not authenticated for this election')
      if (!chainId) {
        throw new Error('Missing chainId — the process read did not provide one; cannot cast a vote')
      }
      // Fail before consuming any one-shot CSP signature: a missing ballot at
      // question k would otherwise cast questions 0..k-1 and leave the voter
      // half-voted (and `?? []` would silently cast an empty ballot).
      if (election.questions.length === 0) {
        throw new Error('Process has no questions to vote on')
      }
      if (encodedBallots.length !== election.questions.length) {
        throw new Error(
          `Expected one encoded ballot per question (${election.questions.length}), got ${encodedBallots.length}`,
        )
      }
      if (memos) {
        if (memos.length > election.questions.length) {
          throw new Error(`Got ${memos.length} memos for ${election.questions.length} questions`)
        }
        for (const [i, memo] of memos.entries()) {
          if (memo !== undefined && new TextEncoder().encode(memo).length > MAX_MEMO_BYTES) {
            throw new Error(`Memo for question ${i} exceeds the chain's ${MAX_MEMO_BYTES} UTF-8-byte cap`)
          }
        }
      }

      // Pre-flight EVERY question before anything is consumed or relayed, so a
      // problem at question k can never leave questions 0..k-1 cast on chain.
      // Secret questions must never go out in cleartext: the keykeepers publish
      // the encryption keys asynchronously after publish, so keys may
      // legitimately be absent for a while — refuse rather than cast an
      // unencrypted ballot.
      for (const [i, question] of election.questions.entries()) {
        if (!question.upstreamId) {
          throw new Error(`Question ${i} has no upstreamId; process may not be published yet`)
        }
        if (question.secretUntilTheEnd && !question.encryptionKeys?.length) {
          throw new Error(
            `Question ${i} ("${question.id}") is secret but its encryption keys are not published yet; retry once the keykeepers publish them`,
          )
        }
      }

      // A fresh voter state decides every question. Never sign or relay on a
      // guess: if the check (or the verification it needs) fails, stop here.
      let vs: VoterState
      try {
        vs = await resolveVoterState(client, election, await session.check(), session.owner, session.authToken!)
      } catch (err) {
        throw new Error(COULD_NOT_VERIFY, { cause: err })
      }
      if (vs.unverified) throw new Error(COULD_NOT_VERIFY)
      applyVoterState(vs)

      const stateOf = (question: Question) => vs.states[question.id]
      if (election.questions.every((q) => stateOf(q) === 'confirmed')) {
        setHasVoted(true)
        throw new Error('Every question of this process has already been voted')
      }
      const reused = pendingItems(vs)
      if (reused.length > 0 && status !== 'ONGOING') {
        throw new Error('Voting is not open — the stored vote cannot be re-sent')
      }
      const open = election.questions
        .map((question, i) => ({ question, i }))
        .filter(({ question }) => stateOf(question) === 'open')
      if (reused.length + open.length === 0) {
        throw new UnconfirmedVoteError(
          election.questions.flatMap((q) => {
            const st = stateOf(q)
            return st === 'unconfirmed' || st === 'signed' ? [{ questionId: q.id, status: st }] : []
          }),
        )
      }
      // Fail before consuming any CSP signature: the batch endpoint hard-caps
      // at 100 envelopes and would reject the whole relay.
      if (reused.length + open.length > MAX_VOTE_BATCH) {
        throw new Error(
          `Cannot cast ${reused.length + open.length} votes in one call — the batch relay caps at ${MAX_VOTE_BATCH}`,
        )
      }

      setVoteStatus(Object.fromEntries(election.questions.map((q) => [q.id, initialStatus[stateOf(q)]])))

      // Consume the open questions' one-shot CSP signatures — all in ONE
      // sign-batch call — and build and store every transaction BEFORE
      // relaying anything. Pending questions reuse their stored tx.
      const fresh: RelayItem[] = []
      const signFailures: Array<{ questionId: string; error: unknown }> = []
      if (open.length > 0) {
        const signers = open.map(() => new EphemeralSigner())
        const signatures = await session.signBatch(
          open.map(({ question }, k) => ({
            electionId: question.upstreamId!,
            address: signers[k].address,
          })),
        )
        // An anonymous census gets a blind CSP signature, which the chain
        // verifies against the blind-salted census key rather than as a plain
        // ECDSA signature over the bundle.
        const proofType = election.census?.anonymous ? ProofCA_Type.ECDSA_BLIND_PIDSALTED : undefined

        // A CSP signature is one-shot: signBatch() has already consumed every
        // authorization it granted. Throwing here would discard the successful
        // ones unrelayed, so relay what did sign and report the rest as a
        // partial failure.
        open.forEach(({ question, i }, k) => {
          const result = signatures[k]
          if (!result?.signature) {
            signFailures.push({
              questionId: question.id,
              error: new Error(
                `The CSP did not sign question ${i} ("${question.id}"): ${result?.error ?? result?.code ?? 'no result'}`,
              ),
            })
            setVoteStatus((st) => ({ ...st, [question.id]: 'failed' }))
            return
          }
          const txPayload = buildVoteTransaction({
            processId: question.upstreamId!,
            choices: encodedBallots[i],
            chainId,
            signer: signers[k],
            cspSignature: result.signature,
            cspWeight: result.weight,
            proofType,
            encryptionKeys: question.secretUntilTheEnd ? question.encryptionKeys : undefined,
            memo: memos?.[i],
          })
          const nullifier = voteNullifier(signers[k].address, question.upstreamId!)
          // Stored BEFORE the relay: a relay whose answer never comes back can
          // then be re-sent as the same bytes, with no new signature.
          if (session.owner) {
            savePendingVote(question.upstreamId!, { owner: session.owner, nullifier, txPayload, savedAt: Date.now() })
          }
          fresh.push({ question, i, txPayload, nullifier })
          setVoteStatus((st) => ({ ...st, [question.id]: 'submitting' }))
        })
      }

      // Nothing to relay at all: nothing was consumed that a retry could not
      // consume again, so this is a plain, fully-retryable error.
      const items = [...reused, ...fresh].sort((a, b) => a.i - b.i)
      if (items.length === 0) throw signFailures[0].error

      const { succeeded, failed: relayFailed } = await relay(items)
      // Questions the CSP refused start out failed: they were never relayed.
      const failed = [...signFailures, ...relayFailed]
      applyRelayResult(vs, succeeded)

      if (failed.length > 0) {
        // `voteId` is null-or-a-real-nullifier; '' would break that for every
        // consumer that treats it as "the vote id we have".
        const firstVoteId = succeeded.find((s) => !!s.voteId)?.voteId
        if (firstVoteId) setVoteId((prev) => prev ?? firstVoteId)
        throw new PartialVoteError(succeeded, failed)
      }

      // The first cast question's vote id (on a resumed call, the first of the
      // questions cast by THIS call).
      const resultVoteId = succeeded[0]?.voteId ?? ''
      if (resultVoteId) setVoteId(resultVoteId)
      return resultVoteId
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [election, session, chainId, client, status, relay, applyVoterState, applyRelayResult],
  )

  // Public vote(): the cast wrapped in the in-flight flag, so UIs can show a
  // "processing your vote" state and guard against double submits. The flag
  // clears on settle either way — including a PartialVoteError, where the UI
  // is expected to offer a retry, not stay stuck "processing".
  const vote = useCallback(
    async (encodedBallots: number[][], memos?: (string | undefined)[]): Promise<string> => {
      if (castInFlightRef.current) {
        throw new Error(
          'A vote for this process is still being relayed — wait for it to settle before voting again',
        )
      }
      castInFlightRef.current = true
      setVoting(true)
      try {
        return await castVotes(encodedBallots, memos)
      } finally {
        castInFlightRef.current = false
        setVoting(false)
      }
    },
    [castVotes],
  )

  // The tab's stored txs are NOT dropped: clearing the session must never lose
  // a vote that is signed but not on chain yet.
  const clearVoter = useCallback(() => {
    setVoteId(null)
    setVoteIds({})
    setVoteStatus({})
    setHasVoted(false)
    setIsInCensus(false)
    setVoterQuestions([])
    setPendingVotes({})
    session.clear()
  }, [session])

  const isAbleToVote =
    session.connected &&
    isInCensus &&
    !hasVoted &&
    voterQuestions.some((q) => q.canVote && !q.hasVoted && (!q.hasSigned || !!pendingVotes[q.questionId]))

  const value = useMemo<ElectionContextValue>(
    () => ({
      election,
      status,
      chainId,
      results,
      loading,
      error: error ?? null,
      authToken: session.authToken,
      connected: session.connected,
      weight: session.weight,
      auth0: session.auth0,
      auth1: session.auth1,
      resend: session.resend,
      check: session.check,
      sign: session.sign,
      signBatch: session.signBatch,
      isInCensus,
      voterQuestions,
      hasVoted,
      pendingVotes,
      vote,
      voting,
      voteStatus,
      voteIds,
      voteId,
      isAbleToVote,
      clearVoter,
    }),
    [election, status, chainId, results, loading, error, session, isInCensus, voterQuestions, hasVoted, pendingVotes, vote, voting, voteStatus, voteIds, voteId, isAbleToVote, clearVoter],
  )

  return (
    <ElectionAuthContext.Provider value={session}>
      <ElectionContext.Provider value={value}>{children}</ElectionContext.Provider>
    </ElectionAuthContext.Provider>
  )
}

export function useElection(): ElectionContextValue {
  const ctx = useContext(ElectionContext)
  if (!ctx) {
    throw new Error(
      'useElection() must be used inside <ElectionProvider>. ' +
        'Make sure the component is wrapped in <ElectionProvider>.',
    )
  }
  return ctx
}
