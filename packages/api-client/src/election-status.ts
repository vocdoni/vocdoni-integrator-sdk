import type {
  QuestionStatus,
  VotingProcessQuestion,
  VotingProcessResponse,
  VotingProcessResultsResponse,
} from '@vocdoni/api-types'
import { normalizeQuestionChoiceMeta } from './choice-meta'

/**
 * The backend emits `READY` for a live question at runtime — the same semantic
 * state as `ONGOING`, which is the only name {@link QuestionStatus} declares.
 * Normalize it away at the read boundary so `status === 'ONGOING'` comparisons
 * hold; the wire name `ready` then only exists in the write API
 * (`SetElectionStatusRequest` / `bulkSetQuestionStatus`).
 */
export const normalizeQuestionStatus = (status: string): QuestionStatus =>
  (status === 'READY' ? 'ONGOING' : status) as QuestionStatus

/**
 * Normalizes a process read: every question's status (`READY` → `ONGOING`) and
 * its extended choice info (`metadata.choices` → `choice.meta`, see
 * {@link normalizeQuestionChoiceMeta}).
 *
 * Idempotent, so it is safe to run on data that already went through the
 * client (e.g. a prefetched process handed to `<ElectionProvider election>`).
 */
export const normalizeVotingProcess = <T extends VotingProcessResponse>(process: T): T => ({
  ...process,
  questions: process.questions.map((q) =>
    normalizeQuestionChoiceMeta({ ...q, status: normalizeQuestionStatus(q.status) }),
  ),
})

/**
 * Options for {@link computeProcessStatus}.
 */
export interface ComputeProcessStatusOptions {
  /**
   * The process's scheduled start (`VotingProcessResponse.startDate`). A live
   * (`READY`/`ONGOING`) question of a process that has not reached its start
   * yet derives as `UPCOMING`: the chain rejects votes cast before the start,
   * but the backend still reports the question as `READY`, so without this the
   * status would read as votable. Absent or unparseable dates disable the
   * check (a published process may legitimately lack `startDate` — see the
   * `PublishedVotingProcessResponse` caveat in `@vocdoni/api-types`).
   */
  startDate?: string | Date | null
  /** The instant to compare `startDate` against. Defaults to now. */
  now?: Date
}

const parseDate = (value: string | Date | null | undefined): Date | undefined => {
  if (!value) return undefined
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

/**
 * True when `startDate` parses to an instant after `now` — i.e. the process is
 * scheduled but has not opened yet. Missing or unparseable dates are treated
 * as "already started" so the check can never lock a votable process.
 */
export const isBeforeStart = (startDate: string | Date | null | undefined, now: Date = new Date()): boolean => {
  const start = parseDate(startDate)
  return start !== undefined && start.getTime() > now.getTime()
}

/**
 * Derive a single {@link QuestionStatus} for a process from its questions' statuses.
 *
 * Rules (applied in order):
 * 1. Any question `ONGOING` → `ONGOING` (loudest running state wins)
 * 2. All questions share the same status → that status (e.g. all `RESULTS`, all `PAUSED`)
 * 3. All questions in `{ENDED, RESULTS}` → `ENDED` (mixed: some results still computing)
 * 4. No questions or mixed state → `PROCESS_UNKNOWN`
 *
 * Statuses are normalized first (`READY` → `ONGOING`), so the derivation also
 * holds for raw wire data that didn't pass through the client (e.g. an SSR
 * payload handed to `<ElectionProvider election>`).
 *
 * When `options.startDate` is given and lies in the future (relative to
 * `options.now`, default the current time), every live question is read as
 * `UPCOMING` before the rules run — the chain refuses votes until the start,
 * even though the wire status is already `READY`. Pass the process's
 * `startDate` whenever it is at hand; {@link isLive} / {@link isUpcoming} do.
 */
export const computeProcessStatus = (
  questions: VotingProcessQuestion[],
  options: ComputeProcessStatusOptions = {},
): QuestionStatus => {
  if (questions.length === 0) return 'PROCESS_UNKNOWN'

  const beforeStart = isBeforeStart(options.startDate, options.now)
  const statuses = questions.map((q) => {
    const status = normalizeQuestionStatus(q.status)
    return beforeStart && status === 'ONGOING' ? 'UPCOMING' : status
  })

  if (statuses.includes('ONGOING')) return 'ONGOING'

  const first = statuses[0]
  if (statuses.every((s) => s === first)) return first

  if (statuses.every((s) => s === 'ENDED' || s === 'RESULTS')) return 'ENDED'

  return 'PROCESS_UNKNOWN'
}

/** Derives the process status honouring the process's own `startDate`. */
const processStatus = (process: VotingProcessResponse, now?: Date): QuestionStatus =>
  computeProcessStatus(process.questions, { startDate: process.startDate, now })

/**
 * True when the process is actively accepting votes (`ONGOING`) — live
 * questions whose `startDate` has passed (relative to `now`, default the
 * current time).
 */
export const isLive = (process: VotingProcessResponse, now?: Date): boolean =>
  processStatus(process, now) === 'ONGOING'

/**
 * True when the process is scheduled but not yet started (`UPCOMING`) — either
 * reported as such, or live on the wire with a `startDate` still ahead of `now`
 * (default the current time).
 */
export const isUpcoming = (process: VotingProcessResponse, now?: Date): boolean =>
  processStatus(process, now) === 'UPCOMING'

/** True when all question results are final (`RESULTS`). */
export const hasResults = (process: VotingProcessResponse): boolean =>
  computeProcessStatus(process.questions) === 'RESULTS'

/** True when any question hides its tallies until the vote ends. */
export const isSecretUntilTheEnd = (process: VotingProcessResponse): boolean =>
  process.questions.some((q) => q.secretUntilTheEnd)

/**
 * Ballots cast for the process: the highest per-question vote count. Every voter
 * votes each question of the process, so the max approximates unique ballots better
 * than a sum (which would count one voter N times for N questions).
 */
export const processVoteCount = (results: VotingProcessResultsResponse | null | undefined): number =>
  results?.questions.reduce((max, q) => Math.max(max, q.voteCount ?? 0), 0) ?? 0
