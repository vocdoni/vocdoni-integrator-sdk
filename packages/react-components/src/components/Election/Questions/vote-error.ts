/** One question's failure, as carried by `PartialVoteError.failed`. */
type FailedQuestion = { questionId: string; error: unknown }

/**
 * A `PartialVoteError` from `useElection().vote()`, matched by `name` rather
 * than `instanceof`: two resolved copies of the providers package give two
 * distinct classes, and a mocked module leaves the export undefined.
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
 * reason, and repeating it once per question would bury it.
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
 * Turns a thrown `vote()` failure into the sentence the voter reads: a
 * localized lead plus the chain's own reason, relayed by the backend as each
 * envelope's `error` and the only account of why the vote did not count.
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
