import type { ApiErrorDataByCode, CensusGrowthQuote, PaymentRequiredData } from '@vocdoni/api-types'
import { isResponseError } from 'up-fetch'

export class VocdoniApiError extends Error {
  status: number
  body: unknown
  /** Backend error code (the `code` field of the API error body), when present. */
  code?: number
  /** Backend error `data` (the `data` field of the API error body), when present. */
  data?: unknown

  constructor(status: number, body: unknown, message: string, code?: number, data?: unknown) {
    super(message)
    this.name = 'VocdoniApiError'
    this.status = status
    this.body = body
    this.code = code
    this.data = data
  }
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
    throw new VocdoniApiError(err.status, err.data, message, code, errData)
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
