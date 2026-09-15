/** One question's failure, as carried by `PartialVoteError.failed`. */
type FailedQuestion = { questionId: string; error: unknown }

/**
 * Shape of a `PartialVoteError` thrown by `useElection().vote()`, matched
 * structurally rather than with `instanceof`.
 *
 * `instanceof` would mean importing the class from `@vocdoni/react-providers`
 * for a value check, which breaks in two ways this package cannot control: a
 * consumer resolving two copies of the providers package gets two distinct
 * classes, and a test that mocks the module leaves the export undefined, where
 * `instanceof` throws. The `name` is part of the error's public contract.
 */
type PartialVoteErrorLike = Error & {
  succeeded?: Array<{ questionId: string }>
  failed?: FailedQuestion[]
}

const isPartialVoteError = (error: unknown): error is PartialVoteErrorLike =>
  error instanceof Error && error.name === 'PartialVoteError' && Array.isArray((error as PartialVoteErrorLike).failed)

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : typeof error === 'string' ? error : ''

/**
 * Distinct per-question reasons, in order. A batch usually fails for one
 * reason (the process is not open, the census proof is stale), and repeating
 * it once per question would bury it.
 */
const distinctReasons = (failed: FailedQuestion[]): string[] => {
  const seen = new Set<string>()
  for (const f of failed) {
    const message = messageOf(f.error).trim()
    if (message) seen.add(message)
  }
  return [...seen]
}

export type VoteErrorTranslate = (key: string, substitutions?: Record<string, unknown>) => string

/**
 * Turns a thrown `vote()` failure into the sentence the voter reads.
 *
 * The reason is always included when there is one. These messages originate at
 * the chain (relayed verbatim by the backend as each envelope's `error`) and
 * are the only account of why a vote did not count — dropping them for a
 * tidier sentence is what let votes fail silently (integrator-sdk#53). A
 * localized lead says what happened to the vote; the raw reason follows, for
 * the voter to act on or to report.
 */
export const describeVoteError = (error: unknown, t: VoteErrorTranslate): string => {
  if (isPartialVoteError(error)) {
    const cast = error.succeeded?.length ?? 0
    const failed = error.failed ?? []
    const reasons = distinctReasons(failed)
    return t('errors.vote_partial', {
      cast,
      total: cast + failed.length,
      detail: reasons.join(' '),
    }).trim()
  }

  const detail = messageOf(error).trim()
  return detail ? t('errors.vote_failed', { detail }) : t('errors.vote_failed_unknown')
}
