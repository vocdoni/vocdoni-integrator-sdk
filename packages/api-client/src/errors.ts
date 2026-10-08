import { isResponseError } from 'up-fetch'

export class VocdoniApiError extends Error {
  status: number
  body: unknown
  /** Backend error code (the `code` field of the API error body), when present. */
  code?: number

  constructor(status: number, body: unknown, message: string, code?: number) {
    super(message)
    this.name = 'VocdoniApiError'
    this.status = status
    this.body = body
    this.code = code
  }
}

/**
 * The vote relay refused a vote because the metadata hash on its envelope no
 * longer matches the election's: the ballot text changed after the voter read
 * it. Nothing was relayed, so the voter can retry after reloading the process
 * and re-rendering the ballot from the fresh read. Still a
 * {@link VocdoniApiError}, so code that only checks for that keeps working.
 * Prefer {@link isStaleMetadataError}, which also recognizes the chain's own
 * rejection reported through a vote job.
 */
export class StaleMetadataError extends VocdoniApiError {
  constructor(status: number, body: unknown, message: string, code?: number) {
    super(status, body, message, code)
    this.name = 'StaleMetadataError'
  }
}

/**
 * API error code of `ErrVoteMetadataChanged` (HTTP 409): the vote relay found
 * an envelope `metadataHash` that differs from the question's stored one.
 */
export const VOTE_METADATA_CHANGED_CODE = 40904

export function handleError(err: unknown): never {
  if (isResponseError(err)) {
    const data = (err.data ?? undefined) as Record<string, unknown> | undefined
    // The SaaS API returns errors as `{ error, code }`; older shapes used `message`.
    const message =
      data && typeof data === 'object'
        ? String(data.error ?? data.message ?? err.message)
        : err.message
    const code =
      data && typeof data.code === 'number' ? (data.code as number) : undefined
    if (err.status === 409 && code === VOTE_METADATA_CHANGED_CODE) {
      throw new StaleMetadataError(err.status, err.data, message, code)
    }
    throw new VocdoniApiError(err.status, err.data, message, code)
  }
  throw err
}
