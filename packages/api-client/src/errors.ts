import type { ApiErrorDataByCode, CensusGrowthQuote, PaymentRequiredData } from '@vocdoni/api-types'
import { isResponseError, ResponseError } from 'up-fetch'

export class VocdoniApiError extends Error {
  status: number
  body: unknown
  /** Backend error code (the `code` field of the API error body), when present. */
  code?: number
  /** Backend error `data` (the `data` field of the API error body), when present. */
  data?: unknown
  /** The `Retry-After` header in ms, when the response carried a valid one (e.g. on 429/503). */
  retryAfterMs?: number

  constructor(status: number, body: unknown, message: string, code?: number, data?: unknown) {
    super(message)
    this.name = 'VocdoniApiError'
    this.status = status
    this.body = body
    this.code = code
    this.data = data
  }
}

/** up-fetch's rejection error, carrying the `Retry-After` header that its default one drops. */
type RejectedResponseError = ResponseError & { retryAfter?: string | null }

/**
 * Builds the error of a rejected response as up-fetch's default `parseRejected` does, keeping the
 * `Retry-After` header for {@link handleError}.
 */
export async function parseRejected(res: Response): Promise<RejectedResponseError> {
  const data: unknown = await res
    .clone()
    .json()
    .catch(() => res.text())
    .then((d) => d || null)
  const err: RejectedResponseError = new ResponseError({
    message: `[${res.status}] ${res.statusText}`,
    status: res.status,
    data,
  })
  err.retryAfter = res.headers.get('retry-after')
  return err
}

/** Parses a `Retry-After` header, in seconds or as an HTTP date, into ms from now. */
export function parseRetryAfter(value: string | null | undefined): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return seconds >= 0 ? seconds * 1000 : undefined
  const at = Date.parse(value)
  return Number.isNaN(at) ? undefined : Math.max(at - Date.now(), 0)
}

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
    const errData = data && typeof data === 'object' ? data.data : undefined
    const apiErr = new VocdoniApiError(err.status, err.data, message, code, errData)
    apiErr.retryAfterMs = parseRetryAfter((err as RejectedResponseError).retryAfter)
    throw apiErr
  }
  throw err
}

/** True when `err` is a {@link VocdoniApiError} carrying backend error `code`. */
export function isApiError<C extends number>(
  err: unknown,
  code: C,
): err is VocdoniApiError & {
  code: C
  data: C extends keyof ApiErrorDataByCode ? ApiErrorDataByCode[C] : unknown
} {
  return err instanceof VocdoniApiError && err.code === code
}

/** Tells the 40178 census-growth quote apart from the publish-time {@link PaymentRequiredData}. */
export function isCensusGrowthQuote(
  data: PaymentRequiredData | CensusGrowthQuote,
): data is CensusGrowthQuote {
  return 'dueCents' in data
}
